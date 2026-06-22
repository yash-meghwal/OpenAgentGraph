using SampleMediaPlayer.App.ViewModels;
using SampleMediaPlayer.Core.Services;

namespace SampleMediaPlayer.App.Controllers;

public class AppController
{
    private readonly MainViewModel _mainViewModel;
    private readonly MpvPlayerAdapter _playerAdapter;

    public AppController(MainViewModel mainViewModel, MpvPlayerAdapter playerAdapter)
    {
        _mainViewModel = mainViewModel;
        _playerAdapter = playerAdapter;
    }

    public void Start() => _playerAdapter.StartPlayback();
}