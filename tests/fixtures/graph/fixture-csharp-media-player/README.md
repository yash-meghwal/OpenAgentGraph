# fixture-csharp-media-player

CI stand-in for a representative C# WPF media-player workspace. The fixture
keeps realistic project, XAML, ViewModel, adapter, service, controller, docs,
and test relationships without referencing a private application.

## Navigation anchors

- `MainViewModel` -> `MpvPlayerAdapter` should resolve through code relationships.
- `AppController` is the preferred community entrypoint over alphabetical services.
- `docs/playback.md` documents playback symbols with wikilinks.
