using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using System;
using System.Threading;
using System.Threading.Tasks;
using WechatClawHub.WinUI.Services;

namespace WechatClawHub.WinUI;

public sealed partial class MainWindow : Window
{
    private readonly LauncherSupervisor launcherSupervisor = new();
    private readonly Uri consoleUri = new("http://127.0.0.1:8765/");
    private CancellationTokenSource startupCancellation = new();
    private Grid titleBarDragRegion = null!;
    private Grid webViewHost = null!;
    private Grid startupOverlay = null!;
    private TextBlock statusTitle = null!;
    private TextBlock statusDetail = null!;
    private TextBlock retryText = null!;
    private WebView2? consoleWebView;
    private bool startupAttempted;

    public MainWindow()
    {
        InitializeComponent();
        Title = "WeChat Claw Hub";
        BuildLayout();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(titleBarDragRegion);
        ConfigureSystemTitleBarColors();
        AppLog.Info("MainWindow initialized.");
        Closed += MainWindow_Closed;
    }

    private async void Root_Loaded(object sender, RoutedEventArgs e)
    {
        if (startupAttempted)
        {
            return;
        }

        startupAttempted = true;
        await StartLocalRuntimeAsync();
    }

    private async void RetryButton_Click(object sender, RoutedEventArgs e)
    {
        await RestartStartupAsync();
    }

    private async void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        AppLog.Info("Window refresh requested.");
        if (consoleWebView is { Visibility: Visibility.Visible } webView)
        {
            try
            {
                if (webView.CoreWebView2 is null)
                {
                    await webView.EnsureCoreWebView2Async();
                }

                webView.CoreWebView2?.Reload();
                return;
            }
            catch (Exception exception)
            {
                AppLog.Error("WebView refresh failed.", exception);
                ShowFailure($"页面刷新失败：{exception.Message}");
                return;
            }
        }

        await RestartStartupAsync();
    }

    private async Task StartLocalRuntimeAsync()
    {
        ShowStarting();
        AppLog.Info("Starting local runtime check.");

        LauncherStartResult result;
        try
        {
            result = await launcherSupervisor.EnsureRunningAsync(startupCancellation.Token);
            AppLog.Info($"Launcher state: {result.State}. {result.Detail}");
        }
        catch (OperationCanceledException)
        {
            AppLog.Info("Startup cancelled.");
            return;
        }
        catch (Exception exception)
        {
            AppLog.Error("Launcher startup failed.", exception);
            EnqueueOnUi(() => ShowFailure(exception.Message));
            return;
        }

        EnqueueOnUi(async () => await CompleteStartupOnUiAsync(result));
    }

    private async Task CompleteStartupOnUiAsync(LauncherStartResult result)
    {
        if (result.State is not (LauncherRuntimeState.Ready or LauncherRuntimeState.ExternalRunning))
        {
            ShowFailure(result.Detail);
            return;
        }

        try
        {
            AppLog.Info("Initializing WebView2.");
            WebView2 webView = EnsureConsoleWebView();
            await webView.EnsureCoreWebView2Async();
            webView.Source = consoleUri;
            webView.Visibility = Visibility.Visible;
            startupOverlay.Visibility = Visibility.Collapsed;
            AppLog.Info("WebView2 ready.");
        }
        catch (Exception exception)
        {
            AppLog.Error("WebView2 initialization failed.", exception);
            ShowFailure($"WebView2 初始化失败：{exception.Message}");
        }
    }

    private async Task RestartStartupAsync()
    {
        startupCancellation.Cancel();
        startupCancellation.Dispose();
        startupCancellation = new CancellationTokenSource();
        await StartLocalRuntimeAsync();
    }

    private async void MainWindow_Closed(object sender, WindowEventArgs args)
    {
        AppLog.Info("MainWindow closed.");
        startupCancellation.Cancel();
        startupCancellation.Dispose();
        await launcherSupervisor.StopOwnedRuntimeAsync();
        launcherSupervisor.Dispose();
    }

    private void ShowStarting()
    {
        if (consoleWebView is not null)
        {
            consoleWebView.Visibility = Visibility.Collapsed;
        }

        startupOverlay.Visibility = Visibility.Visible;
        retryText.Visibility = Visibility.Collapsed;
        statusTitle.Text = "正在启动本地服务";
        statusDetail.Text = "正在检查 127.0.0.1:8765 的桌面启动器状态。";
    }

    private void ShowFailure(string detail)
    {
        if (consoleWebView is not null)
        {
            consoleWebView.Visibility = Visibility.Collapsed;
        }

        startupOverlay.Visibility = Visibility.Visible;
        retryText.Visibility = Visibility.Visible;
        statusTitle.Text = "本地服务启动失败";
        statusDetail.Text = string.IsNullOrWhiteSpace(detail) ? "未能连接到桌面启动器。" : detail;
    }

    private WebView2 EnsureConsoleWebView()
    {
        if (consoleWebView is not null)
        {
            return consoleWebView;
        }

        consoleWebView = new WebView2
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            Visibility = Visibility.Collapsed,
        };
        webViewHost.Children.Add(consoleWebView);
        return consoleWebView;
    }

    private void EnqueueOnUi(Action action)
    {
        if (DispatcherQueue.HasThreadAccess)
        {
            action();
            return;
        }

        DispatcherQueue.TryEnqueue(() => action());
    }

    private void BuildLayout()
    {
        Root.Background = SolidColorBrush("#0F172A");
        Root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(40) });
        Root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        webViewHost = new Grid();
        startupOverlay = new Grid
        {
            Background = SolidColorBrush("#0F172A"),
        };

        Grid titleBar = BuildTitleBar();
        Grid contentHost = new();
        Grid.SetRow(titleBar, 0);
        Grid.SetRow(contentHost, 1);

        StackPanel startupPanel = new()
        {
            Width = 420,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = 18,
        };

        startupPanel.Children.Add(new TextBlock
        {
            Text = "WeChat Claw Hub",
            Foreground = SolidColorBrush("#F8FAFC"),
            FontSize = 30,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            TextAlignment = TextAlignment.Center,
        });

        statusTitle = new TextBlock
        {
            Text = "正在启动本地服务",
            Foreground = SolidColorBrush("#E2E8F0"),
            FontSize = 18,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            TextAlignment = TextAlignment.Center,
        };
        startupPanel.Children.Add(statusTitle);

        statusDetail = new TextBlock
        {
            Text = "正在检查 127.0.0.1:8765 的桌面启动器状态。",
            Foreground = SolidColorBrush("#94A3B8"),
            FontSize = 13,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
        };
        startupPanel.Children.Add(statusDetail);

        retryText = new TextBlock
        {
            Text = "重试",
            Visibility = Visibility.Collapsed,
            HorizontalAlignment = HorizontalAlignment.Center,
            Foreground = SolidColorBrush("#93C5FD"),
            FontSize = 15,
            TextAlignment = TextAlignment.Center,
        };
        retryText.Tapped += RetryText_Tapped;
        startupPanel.Children.Add(retryText);

        startupOverlay.Children.Add(startupPanel);
        contentHost.Children.Add(webViewHost);
        contentHost.Children.Add(startupOverlay);
        Root.Children.Add(titleBar);
        Root.Children.Add(contentHost);
    }

    private Grid BuildTitleBar()
    {
        Grid titleBar = new()
        {
            Height = 40,
            Background = SolidColorBrush("#0B1220"),
        };
        titleBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        titleBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(138) });

        titleBarDragRegion = new Grid
        {
            Background = SolidColorBrush("#0B1220"),
            Padding = new Thickness(14, 0, 0, 0),
        };

        StackPanel titleStack = new()
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleStack.Children.Add(new Border
        {
            Width = 18,
            Height = 18,
            CornerRadius = new CornerRadius(6),
            Background = SolidColorBrush("#2563EB"),
        });
        titleStack.Children.Add(new TextBlock
        {
            Text = "WeChat Claw Hub",
            Foreground = SolidColorBrush("#E2E8F0"),
            FontSize = 12,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleBarDragRegion.Children.Add(titleStack);

        StackPanel refreshContent = new()
        {
            Orientation = Orientation.Horizontal,
            Spacing = 5,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        refreshContent.Children.Add(new TextBlock
        {
            Text = "⟳",
            Foreground = SolidColorBrush("#F8FAFC"),
            FontSize = 15,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center,
        });
        refreshContent.Children.Add(new TextBlock
        {
            Text = "刷新",
            Foreground = SolidColorBrush("#F8FAFC"),
            FontSize = 12,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center,
        });

        Button refreshButton = new()
        {
            Width = 68,
            Height = 30,
            Padding = new Thickness(0),
            Margin = new Thickness(0, 6, 8, 6),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            Background = SolidColorBrush("#172033"),
            BorderBrush = SolidColorBrush("#334155"),
            Foreground = SolidColorBrush("#F8FAFC"),
            Content = refreshContent,
        };
        ToolTipService.SetToolTip(refreshButton, "刷新当前页面");
        refreshButton.Click += RefreshButton_Click;

        Grid.SetColumn(titleBarDragRegion, 0);
        Grid.SetColumn(refreshButton, 1);
        titleBar.Children.Add(titleBarDragRegion);
        titleBar.Children.Add(refreshButton);
        return titleBar;
    }

    private void ConfigureSystemTitleBarColors()
    {
        AppWindowTitleBar titleBar = AppWindow.TitleBar;
        titleBar.ButtonBackgroundColor = ColorFromHex("#0B1220");
        titleBar.ButtonInactiveBackgroundColor = ColorFromHex("#0B1220");
        titleBar.ButtonHoverBackgroundColor = ColorFromHex("#1E293B");
        titleBar.ButtonPressedBackgroundColor = ColorFromHex("#334155");
        titleBar.ButtonForegroundColor = ColorFromHex("#F8FAFC");
        titleBar.ButtonInactiveForegroundColor = ColorFromHex("#94A3B8");
        titleBar.ButtonHoverForegroundColor = ColorFromHex("#FFFFFF");
        titleBar.ButtonPressedForegroundColor = ColorFromHex("#FFFFFF");
    }

    private static SolidColorBrush SolidColorBrush(string hex)
    {
        return new SolidColorBrush(ColorFromHex(hex));
    }

    private static Windows.UI.Color ColorFromHex(string hex)
    {
        byte red = Convert.ToByte(hex.Substring(1, 2), 16);
        byte green = Convert.ToByte(hex.Substring(3, 2), 16);
        byte blue = Convert.ToByte(hex.Substring(5, 2), 16);
        return Windows.UI.Color.FromArgb(255, red, green, blue);
    }

    private void RetryText_Tapped(object sender, TappedRoutedEventArgs e)
    {
        RetryButton_Click(sender, e);
    }
}
