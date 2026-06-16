using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Build.Locator;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.MSBuild;

namespace OpenAgentGraph.RoslynHelper;

internal static class Program
{
    public static async Task<int> Main()
    {
        try
        {
            var input = await Console.In.ReadToEndAsync();
            if (string.IsNullOrWhiteSpace(input))
            {
                await WriteResponseAsync(new RoslynHelperResponse
                {
                    Status = "failed",
                    Reason = "No JSON input received on stdin.",
                });
                return 1;
            }

            var request = JsonSerializer.Deserialize<RoslynHelperRequest>(input, RoslynJson.Options);
            if (request is null || string.IsNullOrWhiteSpace(request.WorkspaceRoot))
            {
                await WriteResponseAsync(new RoslynHelperResponse
                {
                    Status = "failed",
                    Reason = "workspaceRoot is required.",
                });
                return 1;
            }

            var response = await SemanticAnalyzer.AnalyzeAsync(request);
            await WriteResponseAsync(response);
            return response.Status == "ok" ? 0 : 1;
        }
        catch (Exception ex)
        {
            await WriteResponseAsync(new RoslynHelperResponse
            {
                Status = "failed",
                Reason = ex.Message,
            });
            return 1;
        }
    }

    private static async Task WriteResponseAsync(RoslynHelperResponse response)
    {
        var json = JsonSerializer.Serialize(response, RoslynJson.Options);
        Console.Out.Write(json);
        await Console.Out.FlushAsync();
    }
}

internal sealed class RoslynHelperRequest
{
    public string WorkspaceRoot { get; set; } = "";
    public string? SolutionPath { get; set; }
    public List<string>? ProjectPaths { get; set; }
    public RoslynHelperLimits? Limits { get; set; }
}

internal sealed class RoslynHelperLimits
{
    public int MaxFiles { get; set; } = 200;
    public int MaxDurationMs { get; set; } = 30_000;
    public int MaxEdges { get; set; } = 2_000;
    public int MaxOutputBytes { get; set; } = 2_000_000;
}

internal sealed class RoslynHelperResponse
{
    public string Status { get; set; } = "failed";
    public string? Reason { get; set; }
    public List<string> Diagnostics { get; set; } = [];
    public List<RoslynSemanticEdge> Edges { get; set; } = [];
    public RoslynHelperStats? Stats { get; set; }
}

internal sealed class RoslynHelperStats
{
    public int FilesAnalyzed { get; set; }
    public int EdgeCount { get; set; }
    public int DurationMs { get; set; }
    public int OutputBytes { get; set; }
    public string Mode { get; set; } = "adhoc";
}

internal sealed class RoslynSemanticEdge
{
    public string SourceFile { get; set; } = "";
    public string SourceKind { get; set; } = "";
    public string SourceName { get; set; } = "";
    public string? SourceParentType { get; set; }
    public string TargetFile { get; set; } = "";
    public string TargetKind { get; set; } = "";
    public string TargetName { get; set; } = "";
    public string? TargetParentType { get; set; }
    public string EdgeKind { get; set; } = "";
    public int Line { get; set; }
    public string Relation { get; set; } = "";
}

internal static class SemanticAnalyzer
{
    private static readonly HashSet<string> SkippedDirectoryNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git", ".oag", "bin", "obj", "node_modules", "dist", "build", "target", ".vs", ".idea",
    };

    public static async Task<RoslynHelperResponse> AnalyzeAsync(RoslynHelperRequest request)
    {
        var startedAt = Environment.TickCount64;
        var limits = request.Limits ?? new RoslynHelperLimits();
        using var cts = new CancellationTokenSource(limits.MaxDurationMs);
        var token = cts.Token;
        var workspaceRoot = Path.GetFullPath(request.WorkspaceRoot);
        var diagnostics = new List<string>();

        if (!string.IsNullOrWhiteSpace(request.SolutionPath))
        {
            if (!TryResolveWorkspaceFile(workspaceRoot, request.SolutionPath!, out var solutionPath, out var pathError))
            {
                return Failed(pathError ?? "Invalid solution path.", diagnostics, startedAt, limits.MaxOutputBytes);
            }
            if (!File.Exists(solutionPath))
            {
                return Failed($"Solution not found: {request.SolutionPath}", diagnostics, startedAt, limits.MaxOutputBytes);
            }
        }

        var msBuildResult = await TryAnalyzeWithMsBuildAsync(request, workspaceRoot, limits, diagnostics, startedAt, token);
        if (msBuildResult is not null)
        {
            return msBuildResult;
        }

        diagnostics.Add("MSBuild workspace unavailable; using adhoc Roslyn compilation.");
        return AnalyzeWithAdhocCompilation(workspaceRoot, limits, diagnostics, startedAt, token);
    }

    private static async Task<RoslynHelperResponse?> TryAnalyzeWithMsBuildAsync(
        RoslynHelperRequest request,
        string workspaceRoot,
        RoslynHelperLimits limits,
        List<string> diagnostics,
        long startedAt,
        CancellationToken token)
    {
        try
        {
            if (!MSBuildLocator.IsRegistered)
            {
                var instances = MSBuildLocator.QueryVisualStudioInstances().OrderByDescending(i => i.Version).ToArray();
                if (instances.Length == 0)
                {
                    return null;
                }
                MSBuildLocator.RegisterInstance(instances[0]);
            }

            using var workspace = MSBuildWorkspace.Create();
            Solution? solution = null;
            if (!string.IsNullOrWhiteSpace(request.SolutionPath))
            {
                if (!TryResolveWorkspaceFile(workspaceRoot, request.SolutionPath!, out var solutionPath, out _))
                {
                    return null;
                }
                solution = await workspace.OpenSolutionAsync(solutionPath, cancellationToken: token);
            }
            else if (request.ProjectPaths is { Count: > 0 })
            {
                foreach (var projectPath in request.ProjectPaths)
                {
                    if (!TryResolveWorkspaceFile(workspaceRoot, projectPath, out var absoluteProject, out _))
                    {
                        continue;
                    }
                    if (!File.Exists(absoluteProject)) continue;
                    var project = await workspace.OpenProjectAsync(absoluteProject, cancellationToken: token);
                    solution = project.Solution;
                    break;
                }
            }

            if (solution is null) return null;

            var edges = new List<RoslynSemanticEdge>();
            var filesAnalyzed = 0;
            var knownFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var project in solution.Projects)
            {
                foreach (var document in project.Documents)
                {
                    if (document.FilePath is null || !document.FilePath.EndsWith(".cs", StringComparison.OrdinalIgnoreCase)) continue;
                    var relativePath = ToWorkspaceRelative(workspaceRoot, document.FilePath);
                    if (relativePath is null) continue;
                    knownFiles.Add(relativePath);
                }
            }

            foreach (var project in solution.Projects)
            {
                foreach (var document in project.Documents)
                {
                    token.ThrowIfCancellationRequested();
                    if (filesAnalyzed >= limits.MaxFiles || edges.Count >= limits.MaxEdges) break;
                    if (document.FilePath is null || !document.FilePath.EndsWith(".cs", StringComparison.OrdinalIgnoreCase)) continue;
                    var relativePath = ToWorkspaceRelative(workspaceRoot, document.FilePath);
                    if (relativePath is null) continue;
                    var tree = await document.GetSyntaxTreeAsync(token);
                    var model = tree is null ? null : await document.GetSemanticModelAsync(token);
                    if (tree is null || model is null) continue;
                    filesAnalyzed += 1;
                    EdgeCollector.CollectFromTree(relativePath, tree, model, edges, knownFiles, limits, token);
                }
            }

            EdgeCollector.CollectTestEdges(solution, workspaceRoot, edges, knownFiles, limits, token);
            return Success(edges, filesAnalyzed, startedAt, limits.MaxOutputBytes, "msbuild", diagnostics);
        }
        catch (Exception ex)
        {
            diagnostics.Add($"MSBuild analysis skipped: {ex.Message}");
            return null;
        }
    }

    private static RoslynHelperResponse AnalyzeWithAdhocCompilation(
        string workspaceRoot,
        RoslynHelperLimits limits,
        List<string> diagnostics,
        long startedAt,
        CancellationToken token)
    {
        var sourceFiles = DiscoverSourceFiles(workspaceRoot, limits.MaxFiles);
        if (sourceFiles.Count == 0)
        {
            return Failed("No C# source files discovered for adhoc compilation.", diagnostics, startedAt, limits.MaxOutputBytes);
        }

        var trees = new List<SyntaxTree>();
        var knownFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var relativePath in sourceFiles)
        {
            token.ThrowIfCancellationRequested();
            var absolutePath = Path.Combine(workspaceRoot, relativePath.Replace('/', Path.DirectorySeparatorChar));
            var text = File.ReadAllText(absolutePath);
            trees.Add(CSharpSyntaxTree.ParseText(text, path: absolutePath));
            knownFiles.Add(relativePath);
        }

        var references = ResolveMetadataReferences();
        var compilation = CSharpCompilation.Create(
            assemblyName: "OagSemanticScratch",
            syntaxTrees: trees,
            references: references,
            options: new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));

        var edges = new List<RoslynSemanticEdge>();
        foreach (var tree in trees)
        {
            token.ThrowIfCancellationRequested();
            if (edges.Count >= limits.MaxEdges) break;
            var relativePath = ToWorkspaceRelative(workspaceRoot, tree.FilePath);
            if (relativePath is null) continue;
            var model = compilation.GetSemanticModel(tree);
            EdgeCollector.CollectFromTree(relativePath, tree, model, edges, knownFiles, limits, token);
        }

        EdgeCollector.CollectAdhocTestEdges(compilation, workspaceRoot, edges, knownFiles, limits, token);
        return Success(edges, sourceFiles.Count, startedAt, limits.MaxOutputBytes, "adhoc", diagnostics);
    }

    private static List<string> DiscoverSourceFiles(string workspaceRoot, int maxFiles)
    {
        var results = new List<string>();
        var pending = new Stack<string>();
        pending.Push(workspaceRoot);
        while (pending.Count > 0 && results.Count < maxFiles)
        {
            var current = pending.Pop();
            IEnumerable<string> directories;
            IEnumerable<string> files;
            try
            {
                directories = Directory.EnumerateDirectories(current);
                files = Directory.EnumerateFiles(current, "*.cs");
            }
            catch
            {
                continue;
            }

            foreach (var directory in directories)
            {
                if (SkippedDirectoryNames.Contains(Path.GetFileName(directory))) continue;
                pending.Push(directory);
            }

            foreach (var file in files)
            {
                var relative = ToWorkspaceRelative(workspaceRoot, file);
                if (relative is not null) results.Add(relative);
                if (results.Count >= maxFiles) break;
            }
        }

        return results.OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static List<MetadataReference> ResolveMetadataReferences()
    {
        var results = new List<MetadataReference>();
        var trusted = (AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string)?.Split(Path.PathSeparator)
            ?? [];
        foreach (var assemblyPath in trusted)
        {
            if (!File.Exists(assemblyPath)) continue;
            results.Add(MetadataReference.CreateFromFile(assemblyPath));
        }

        if (results.Count == 0)
        {
            var fallbackAssemblies = new[]
            {
                typeof(object).Assembly,
                typeof(Enumerable).Assembly,
                typeof(Task).Assembly,
            };
            foreach (var assembly in fallbackAssemblies)
            {
                if (!string.IsNullOrWhiteSpace(assembly.Location))
                {
                    results.Add(MetadataReference.CreateFromFile(assembly.Location));
                }
            }
        }

        return results;
    }

    private static RoslynHelperResponse Success(
        List<RoslynSemanticEdge> edges,
        int filesAnalyzed,
        long startedAt,
        int maxOutputBytes,
        string mode,
        List<string> diagnostics)
    {
        var truncated = false;
        while (true)
        {
            var response = new RoslynHelperResponse
            {
                Status = "ok",
                Diagnostics = diagnostics,
                Edges = edges,
                Stats = new RoslynHelperStats
                {
                    FilesAnalyzed = filesAnalyzed,
                    EdgeCount = edges.Count,
                    DurationMs = (int)Math.Max(0, Environment.TickCount64 - startedAt),
                    Mode = mode,
                },
            };
            var outputBytes = MeasureResponseBytes(response);
            if (outputBytes <= maxOutputBytes || edges.Count == 0)
            {
                response.Stats.OutputBytes = outputBytes;
                return response;
            }

            edges.RemoveAt(edges.Count - 1);
            if (!truncated)
            {
                diagnostics.Add($"Output truncated to respect maxOutputBytes ({maxOutputBytes}).");
                truncated = true;
            }
        }
    }

    private static RoslynHelperResponse Failed(string reason, List<string> diagnostics, long startedAt, int maxOutputBytes)
    {
        var response = new RoslynHelperResponse
        {
            Status = "failed",
            Reason = reason,
            Diagnostics = diagnostics,
            Stats = new RoslynHelperStats
            {
                DurationMs = (int)Math.Max(0, Environment.TickCount64 - startedAt),
            },
        };
        response.Stats.OutputBytes = MeasureResponseBytes(response);
        return response;
    }

    private static int MeasureResponseBytes(RoslynHelperResponse response)
    {
        var json = JsonSerializer.Serialize(response, RoslynJson.Options);
        return Encoding.UTF8.GetByteCount(json);
    }

    internal static bool TryResolveWorkspaceFile(
        string workspaceRoot,
        string requestedPath,
        out string absolutePath,
        out string? error)
    {
        absolutePath = "";
        error = null;
        if (string.IsNullOrWhiteSpace(requestedPath))
        {
            error = "Path is required.";
            return false;
        }

        if (Path.IsPathRooted(requestedPath))
        {
            absolutePath = Path.GetFullPath(requestedPath);
        }
        else
        {
            var normalized = requestedPath.Replace('\\', '/');
            var segments = normalized.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (segments.Any(segment => segment == ".."))
            {
                error = $"Path escapes workspace: {requestedPath}";
                return false;
            }
            absolutePath = Path.GetFullPath(Path.Combine(workspaceRoot, requestedPath));
        }

        if (!IsInsideWorkspace(workspaceRoot, absolutePath, out _))
        {
            error = $"Path escapes workspace: {requestedPath}";
            return false;
        }

        return true;
    }

    internal static bool IsInsideWorkspace(string workspaceRoot, string absolutePath, out string relativePath)
    {
        relativePath = "";
        var fullWorkspace = Path.GetFullPath(workspaceRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var fullPath = Path.GetFullPath(absolutePath);
        var relative = Path.GetRelativePath(fullWorkspace, fullPath);
        if (string.IsNullOrEmpty(relative) || relative == ".")
        {
            return true;
        }
        if (Path.IsPathRooted(relative))
        {
            return false;
        }
        var segments = relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (segments.Any(segment => segment == ".."))
        {
            return false;
        }
        relativePath = relative.Replace('\\', '/');
        return true;
    }

    internal static string? ToWorkspaceRelative(string workspaceRoot, string absolutePath)
    {
        return IsInsideWorkspace(workspaceRoot, absolutePath, out var relativePath) ? relativePath : null;
    }
}

internal static class RoslynJson
{
    internal static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
    };
}

internal static class EdgeCollector
{
    public static void CollectFromTree(
        string relativePath,
        SyntaxTree tree,
        SemanticModel model,
        List<RoslynSemanticEdge> edges,
        HashSet<string> knownFiles,
        RoslynHelperLimits limits,
        CancellationToken token)
    {
        var root = tree.GetRoot(token);
        CollectTypeTopology(relativePath, root, model, edges, knownFiles, limits, token);
        CollectInvocationEdges(relativePath, root, model, edges, knownFiles, limits, token);
    }

    private static void CollectTypeTopology(
        string relativePath,
        SyntaxNode root,
        SemanticModel model,
        List<RoslynSemanticEdge> edges,
        HashSet<string> knownFiles,
        RoslynHelperLimits limits,
        CancellationToken token)
    {
        foreach (var typeDecl in root.DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            token.ThrowIfCancellationRequested();
            if (edges.Count >= limits.MaxEdges) return;
            var typeSymbol = model.GetDeclaredSymbol(typeDecl) as INamedTypeSymbol;
            if (typeSymbol is null) continue;
            if (typeDecl.BaseList is null) continue;
            foreach (var baseType in typeDecl.BaseList.Types)
            {
                if (edges.Count >= limits.MaxEdges) return;
                if (model.GetTypeInfo(baseType.Type, token).Type is not INamedTypeSymbol targetType) continue;
                if (!TryResolveWorkspaceFile(targetType, knownFiles, out var targetFile)) continue;
                var isInterface = targetType.TypeKind == TypeKind.Interface;
                edges.Add(new RoslynSemanticEdge
                {
                    SourceFile = relativePath,
                    SourceKind = MapSymbolKind(typeSymbol),
                    SourceName = typeSymbol.Name,
                    TargetFile = targetFile,
                    TargetKind = MapSymbolKind(targetType),
                    TargetName = targetType.Name,
                    EdgeKind = isInterface ? "implements" : "extends",
                    Relation = isInterface ? "semantic_implements" : "semantic_inherits",
                    Line = baseType.GetLocation().GetLineSpan().StartLinePosition.Line + 1,
                });
            }
        }
    }

    private static void CollectInvocationEdges(
        string relativePath,
        SyntaxNode root,
        SemanticModel model,
        List<RoslynSemanticEdge> edges,
        HashSet<string> knownFiles,
        RoslynHelperLimits limits,
        CancellationToken token)
    {
        foreach (var invocation in root.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            token.ThrowIfCancellationRequested();
            if (edges.Count >= limits.MaxEdges) return;
            if (model.GetSymbolInfo(invocation, token).Symbol is not IMethodSymbol methodSymbol) continue;
            if (methodSymbol.MethodKind is MethodKind.PropertyGet or MethodKind.PropertySet) continue;
            if (!TryGetEnclosingMember(model, invocation, out var sourceKind, out var sourceName, out var sourceParentType)) continue;
            var targetType = methodSymbol.ContainingType;
            if (targetType is null || !TryResolveWorkspaceFile(targetType, knownFiles, out var targetFile)) continue;
            edges.Add(new RoslynSemanticEdge
            {
                SourceFile = relativePath,
                SourceKind = sourceKind,
                SourceName = sourceName,
                SourceParentType = sourceParentType,
                TargetFile = targetFile,
                TargetKind = "method",
                TargetName = methodSymbol.Name,
                TargetParentType = targetType.Name,
                EdgeKind = "calls",
                Relation = "semantic_calls",
                Line = invocation.GetLocation().GetLineSpan().StartLinePosition.Line + 1,
            });
        }

        foreach (var objectCreation in root.DescendantNodes().OfType<ObjectCreationExpressionSyntax>())
        {
            token.ThrowIfCancellationRequested();
            if (edges.Count >= limits.MaxEdges) return;
            if (model.GetTypeInfo(objectCreation, token).Type is not INamedTypeSymbol targetType) continue;
            if (!TryResolveWorkspaceFile(targetType, knownFiles, out var targetFile)) continue;
            if (!TryGetEnclosingMember(model, objectCreation, out var sourceKind, out var sourceName, out var sourceParentType)) continue;
            edges.Add(new RoslynSemanticEdge
            {
                SourceFile = relativePath,
                SourceKind = sourceKind,
                SourceName = sourceName,
                SourceParentType = sourceParentType,
                TargetFile = targetFile,
                TargetKind = "class",
                TargetName = targetType.Name,
                EdgeKind = "uses",
                Relation = "semantic_constructor",
                Line = objectCreation.GetLocation().GetLineSpan().StartLinePosition.Line + 1,
            });
        }
    }

    public static void CollectTestEdges(
        Solution solution,
        string workspaceRoot,
        List<RoslynSemanticEdge> edges,
        HashSet<string> knownFiles,
        RoslynHelperLimits limits,
        CancellationToken token)
    {
        foreach (var project in solution.Projects)
        {
            if (!project.Name.Contains("Test", StringComparison.OrdinalIgnoreCase)) continue;
            foreach (var document in project.Documents)
            {
                if (document.FilePath is null || !document.FilePath.EndsWith(".cs", StringComparison.OrdinalIgnoreCase)) continue;
                var relativePath = SemanticAnalyzer.ToWorkspaceRelative(workspaceRoot, document.FilePath);
                if (relativePath is null) continue;
                var tree = document.GetSyntaxTreeAsync(token).GetAwaiter().GetResult();
                var model = tree is null ? null : document.GetSemanticModelAsync(token).GetAwaiter().GetResult();
                if (tree is null || model is null) continue;
                CollectTestTypeEdges(relativePath, tree.GetRoot(token), model, edges, knownFiles, limits, token, solution, workspaceRoot);
            }
        }
    }

    public static void CollectAdhocTestEdges(
        CSharpCompilation compilation,
        string workspaceRoot,
        List<RoslynSemanticEdge> edges,
        HashSet<string> knownFiles,
        RoslynHelperLimits limits,
        CancellationToken token)
    {
        foreach (var tree in compilation.SyntaxTrees)
        {
            if (tree.FilePath is null || !tree.FilePath.Contains("Test", StringComparison.OrdinalIgnoreCase)) continue;
            var relativePath = SemanticAnalyzer.ToWorkspaceRelative(workspaceRoot, tree.FilePath);
            if (relativePath is null) continue;
            var model = compilation.GetSemanticModel(tree);
            CollectTestTypeEdges(relativePath, tree.GetRoot(token), model, edges, knownFiles, limits, token, compilation, workspaceRoot);
        }
    }

    private static void CollectTestTypeEdges(
        string relativePath,
        SyntaxNode root,
        SemanticModel model,
        List<RoslynSemanticEdge> edges,
        HashSet<string> knownFiles,
        RoslynHelperLimits limits,
        CancellationToken token,
        Solution solution,
        string workspaceRoot)
    {
        foreach (var typeDecl in root.DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (edges.Count >= limits.MaxEdges) return;
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol typeSymbol) continue;
            if (!typeSymbol.Name.EndsWith("Tests", StringComparison.Ordinal)) continue;
            var candidate = typeSymbol.Name[..^5];
            if (!TryFindTypeFile(solution, workspaceRoot, candidate, knownFiles, out var targetFile, out var targetTypeName)) continue;
            edges.Add(new RoslynSemanticEdge
            {
                SourceFile = relativePath,
                SourceKind = "class",
                SourceName = typeSymbol.Name,
                TargetFile = targetFile,
                TargetKind = "class",
                TargetName = targetTypeName,
                EdgeKind = "tests",
                Relation = "semantic_tests",
                Line = typeDecl.GetLocation().GetLineSpan().StartLinePosition.Line + 1,
            });
        }
    }

    private static void CollectTestTypeEdges(
        string relativePath,
        SyntaxNode root,
        SemanticModel model,
        List<RoslynSemanticEdge> edges,
        HashSet<string> knownFiles,
        RoslynHelperLimits limits,
        CancellationToken token,
        CSharpCompilation compilation,
        string workspaceRoot)
    {
        foreach (var typeDecl in root.DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            if (edges.Count >= limits.MaxEdges) return;
            if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol typeSymbol) continue;
            if (!typeSymbol.Name.EndsWith("Tests", StringComparison.Ordinal)) continue;
            var candidate = typeSymbol.Name[..^5];
            if (!TryFindTypeFile(compilation, workspaceRoot, candidate, knownFiles, out var targetFile, out var targetTypeName)) continue;
            edges.Add(new RoslynSemanticEdge
            {
                SourceFile = relativePath,
                SourceKind = "class",
                SourceName = typeSymbol.Name,
                TargetFile = targetFile,
                TargetKind = "class",
                TargetName = targetTypeName,
                EdgeKind = "tests",
                Relation = "semantic_tests",
                Line = typeDecl.GetLocation().GetLineSpan().StartLinePosition.Line + 1,
            });
        }
    }

    private static bool TryFindTypeFile(
        Solution solution,
        string workspaceRoot,
        string typeName,
        HashSet<string> knownFiles,
        out string targetFile,
        out string targetTypeName)
    {
        foreach (var project in solution.Projects)
        {
            foreach (var document in project.Documents)
            {
                if (document.FilePath is null) continue;
                var relativePath = SemanticAnalyzer.ToWorkspaceRelative(workspaceRoot, document.FilePath);
                if (relativePath is null || !knownFiles.Contains(relativePath) || !relativePath.EndsWith(".cs", StringComparison.OrdinalIgnoreCase)) continue;
                var tree = document.GetSyntaxTreeAsync().GetAwaiter().GetResult();
                var model = tree is null ? null : document.GetSemanticModelAsync().GetAwaiter().GetResult();
                if (tree is null || model is null) continue;
                foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
                {
                    if (model.GetDeclaredSymbol(typeDecl) is INamedTypeSymbol symbol && symbol.Name == typeName)
                    {
                        targetFile = relativePath;
                        targetTypeName = typeName;
                        return true;
                    }
                }
            }
        }

        targetFile = "";
        targetTypeName = "";
        return false;
    }

    private static bool TryFindTypeFile(
        CSharpCompilation compilation,
        string workspaceRoot,
        string typeName,
        HashSet<string> knownFiles,
        out string targetFile,
        out string targetTypeName)
    {
        foreach (var tree in compilation.SyntaxTrees)
        {
            if (tree.FilePath is null) continue;
            var relativePath = SemanticAnalyzer.ToWorkspaceRelative(workspaceRoot, tree.FilePath);
            if (relativePath is null || !knownFiles.Contains(relativePath)) continue;
            var model = compilation.GetSemanticModel(tree);
            foreach (var typeDecl in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
            {
                if (model.GetDeclaredSymbol(typeDecl) is INamedTypeSymbol symbol && symbol.Name == typeName)
                {
                    targetFile = relativePath;
                    targetTypeName = typeName;
                    return true;
                }
            }
        }

        targetFile = "";
        targetTypeName = "";
        return false;
    }

    private static bool TryGetEnclosingMember(
        SemanticModel model,
        SyntaxNode node,
        out string kind,
        out string name,
        out string? parentType)
    {
        kind = "method";
        name = "";
        parentType = null;
        var method = node.Ancestors().OfType<MethodDeclarationSyntax>().FirstOrDefault();
        if (method is not null)
        {
            if (model.GetDeclaredSymbol(method) is not IMethodSymbol methodSymbol) return false;
            kind = "method";
            name = methodSymbol.Name;
            parentType = methodSymbol.ContainingType?.Name;
            return true;
        }

        var ctor = node.Ancestors().OfType<ConstructorDeclarationSyntax>().FirstOrDefault();
        if (ctor is not null)
        {
            if (model.GetDeclaredSymbol(ctor) is not IMethodSymbol ctorSymbol) return false;
            kind = "constructor";
            name = ctorSymbol.Name;
            parentType = ctorSymbol.ContainingType?.Name;
            return true;
        }

        return false;
    }

    private static bool TryResolveWorkspaceFile(INamedTypeSymbol typeSymbol, HashSet<string> knownFiles, out string relativePath)
    {
        foreach (var location in typeSymbol.Locations)
        {
            if (!location.IsInSource) continue;
            var filePath = location.SourceTree?.FilePath;
            if (filePath is null) continue;
            var normalized = filePath.Replace('\\', '/');
            foreach (var known in knownFiles)
            {
                if (normalized.EndsWith(known, StringComparison.OrdinalIgnoreCase))
                {
                    relativePath = known;
                    return true;
                }
            }
        }

        relativePath = "";
        return false;
    }

    private static string MapSymbolKind(INamedTypeSymbol symbol)
    {
        return symbol.TypeKind switch
        {
            TypeKind.Interface => "interface",
            TypeKind.Struct => "struct",
            TypeKind.Enum => "enum",
            _ when symbol.IsRecord => "record",
            _ => "class",
        };
    }
}