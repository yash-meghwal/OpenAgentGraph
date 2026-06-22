using SampleMediaPlayer.Core.Services;

namespace SampleMediaPlayer.App.ViewModels;

public class MainViewModel
{
    private readonly MpvPlayerAdapter _playerAdapter;

    public MainViewModel(MpvPlayerAdapter playerAdapter)
    {
        _playerAdapter = playerAdapter;
    }

    public string Title => "SampleMediaPlayer";

    public void Play() => _playerAdapter.StartPlayback();
}