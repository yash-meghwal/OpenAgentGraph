import { describe, expect, it } from "vitest";
import {
  augmentRubySemanticLite,
  buildRubyWorkspaceIndex,
  mapRubySemanticLiteRelationToProductEdgeKind,
  resolveRubyConstant,
  resolveRubyRequireTarget,
} from "./rubySemanticLite.js";

const stableId = (prefix: string, raw: string) => `${prefix}:${raw}`;
const compactMetadata = (values: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));

describe("ruby semantic-lite", () => {
  it("maps semantic-lite relations to product edge kinds", () => {
    expect(mapRubySemanticLiteRelationToProductEdgeKind("extends")).toBe("extends");
    expect(mapRubySemanticLiteRelationToProductEdgeKind("require_relative")).toBe("depends_on");
    expect(mapRubySemanticLiteRelationToProductEdgeKind("rails_route")).toBe("uses");
    expect(mapRubySemanticLiteRelationToProductEdgeKind("gem_dependency")).toBe("depends_on");
  });

  it("resolves require_relative paths to workspace files", () => {
    const fileNodeIdsByPath = new Map([
      ["app/services/user_exporter.rb", stableId("file", "app/services/user_exporter.rb")],
    ]);
    const resolved = resolveRubyRequireTarget(
      "relative:../services/user_exporter",
      "app/models/user.rb",
      fileNodeIdsByPath
    );
    expect(resolved?.targetNodeId).toBe(stableId("file", "app/services/user_exporter.rb"));
  });

  it("keeps multiple methods parented to the same class", () => {
    const files = [
      {
        relativePath: "app/controllers/users_controller.rb",
        body: [
          "class UsersController < ApplicationController",
          "  def index",
          "  end",
          "  def show",
          "  end",
          "end",
        ].join("\n"),
      },
    ];
    const index = buildRubyWorkspaceIndex(files);
    expect(resolveRubyConstant({ simpleOrQualified: "UsersController", index })).toBe("UsersController");
    const semantic = augmentRubySemanticLite({
      scanId: "scan-methods",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath: new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)])),
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });
    const showRoute = semantic.edges.find((edge) => edge.metadata?.scannerRouteAction === "show");
    expect(showRoute).toBeUndefined();
  });

  it("emits gem, require_relative, inheritance, spec, and Rails route edges", () => {
    const files = [
      { relativePath: "Gemfile", body: 'gem "rails"\n' },
      {
        relativePath: "app/models/user.rb",
        body: [
          "require_relative '../services/user_exporter'",
          "class User < ApplicationRecord",
          "  def full_name",
          "  end",
          "end",
        ].join("\n"),
      },
      {
        relativePath: "app/services/user_exporter.rb",
        body: "class UserExporter\nend\n",
      },
      {
        relativePath: "app/controllers/users_controller.rb",
        body: [
          "class UsersController < ApplicationController",
          "  def index",
          "  end",
          "  def show",
          "  end",
          "end",
        ].join("\n"),
      },
      {
        relativePath: "config/routes.rb",
        body: [
          "Rails.application.routes.draw do",
          "  resources :users",
          '  get "/profile", to: "users#show"',
          "end",
        ].join("\n"),
      },
      {
        relativePath: "spec/models/user_spec.rb",
        body: "require 'rails_helper'\nRSpec.describe User\nend\n",
      },
    ];
    const fileNodeIdsByPath = new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)]));
    const semantic = augmentRubySemanticLite({
      scanId: "scan-rails",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath,
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });

    expect(semantic.result.active).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "gem_dependency")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerImportPath === "relative:../services/user_exporter")).toBe(true);
    expect(semantic.edges.some((edge) => edge.kind === "extends")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "tests")).toBe(true);
    expect(semantic.edges.some((edge) => edge.metadata?.scannerRelation === "rails_route")).toBe(true);

    const showRoute = semantic.edges.find((edge) => edge.metadata?.scannerRouteAction === "show");
    expect(showRoute?.targetNodeId).toBe(
      stableId("code-scan:symbol", "app/controllers/users_controller.rb|file|rails_controller|UsersController")
    );
    expect(semantic.externalNodes.some((node) => node.title.includes("rails"))).toBe(true);
  });

  it("tags unresolved require external nodes as external_import, not gem_dependency", () => {
    const files = [
      {
        relativePath: "app/models/user.rb",
        body: [
          "require 'json'",
          "class User",
          "end",
        ].join("\n"),
      },
    ];
    const semantic = augmentRubySemanticLite({
      scanId: "scan-require",
      scannedAt: "2026-01-01T00:00:00.000Z",
      files,
      fileNodeIdsByPath: new Map(files.map((file) => [file.relativePath, stableId("file", file.relativePath)])),
      stableId,
      compactMetadata,
      maxEdgeLabelLength: 120,
      maxTitleLength: 180,
    });
    const jsonNode = semantic.externalNodes.find((node) => node.title.includes("json"));
    expect(jsonNode?.metadata?.scannerRelation).toBe("external_import");
    expect(jsonNode?.metadata?.scannerRelation).not.toBe("gem_dependency");
  });
});