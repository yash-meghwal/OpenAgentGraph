using SampleMediaPlayer.Core.Services;

namespace SampleMediaPlayer.App.ViewModels;

public class MainViewModel
{
    private readonly PlaybackService _playbackService;

    public MainViewModel(PlaybackService playbackService)
    {
        _playbackService = playbackService;
    }

    public string Title => "SampleMediaPlayer";

    public void Play() => _playbackService.Play();
}