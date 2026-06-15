using OpenViewPlayer.Core.Services;

namespace OpenViewPlayer.App.ViewModels;

public class MainViewModel
{
    private readonly PlaybackService _playbackService;

    public MainViewModel(PlaybackService playbackService)
    {
        _playbackService = playbackService;
    }

    public string Title => "OpenViewPlayer";

    public void Play() => _playbackService.Play();
}