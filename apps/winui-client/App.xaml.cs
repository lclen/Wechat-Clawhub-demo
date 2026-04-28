using Microsoft.UI.Xaml;
using System;
using System.Threading;
using WechatClawHub.WinUI.Services;

namespace WechatClawHub.WinUI;

public partial class App : Application
{
    private const string SingleInstanceMutexName = "Global\\WechatClawHub.WinUI.Client";
    private Mutex? singleInstanceMutex;
    private Window? window;

    public App()
    {
        InitializeComponent();
        UnhandledException += App_UnhandledException;
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        singleInstanceMutex = new Mutex(true, SingleInstanceMutexName, out bool createdNew);
        if (!createdNew)
        {
            Environment.Exit(0);
            return;
        }

        window = new MainWindow();
        window.Activate();
    }

    private void App_UnhandledException(object sender, Microsoft.UI.Xaml.UnhandledExceptionEventArgs e)
    {
        AppLog.Error("Unhandled WinUI exception.", e.Exception);
    }
}
