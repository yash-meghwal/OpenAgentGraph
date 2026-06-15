using OpenViewPlayer.App.ViewModels;
using OpenViewPlayer.Core.Services;
using Xunit;

namespace OpenViewPlayer.Tests;

public class MainViewModelTests
{
    [Fact]
    public void Title_is_set()
    {
        var viewModel = new MainViewModel(new PlaybackService());
        Assert.Equal("OpenViewPlayer", viewModel.Title);
    }
}