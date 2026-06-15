using SampleMediaPlayer.App.ViewModels;
using SampleMediaPlayer.Core.Services;
using Xunit;

namespace SampleMediaPlayer.Tests;

public class MainViewModelTests
{
    [Fact]
    public void Title_is_set()
    {
        var viewModel = new MainViewModel(new PlaybackService());
        Assert.Equal("SampleMediaPlayer", viewModel.Title);
    }
}