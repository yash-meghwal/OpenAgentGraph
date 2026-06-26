using SampleMediaPlayer.Core.Common;

namespace SampleMediaPlayer.Core.Services;

public class MpvPlayerAdapter : ObservableObject, IPlayerAdapter
{
    private readonly PlaybackService _playbackService;

    public MpvPlayerAdapter(PlaybackService playbackService)
    {
        _playbackService = playbackService;
    }

    public void StartPlayback() => _playbackService.Play();

    public void StopPlayback() => _playbackService.Pause();
}