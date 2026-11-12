// Окно приложения «Покер»: распаковывает встроенный сервер, запускает его без консоли
// и показывает ссылку для друзей. Собирается штатным csc.exe из .NET Framework 4.
// Оформление — по файлу «ДИЗАЙН-КОД.md»: те же цвета, радиусы и размеры, что в игре.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Покер Офис")]
[assembly: AssemblyProduct("Покер Офис")]
[assembly: AssemblyVersion("1.3.0.0")]

static class Program
{
    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int RegisterWindowMessage(string name);
    [DllImport("user32.dll")]
    static extern bool PostMessage(IntPtr h, int msg, IntPtr w, IntPtr l);

    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);

    static List<IntPtr> OtherWindows()
    {
        HashSet<uint> pids = new HashSet<uint>();
        Process me = Process.GetCurrentProcess();
        foreach (Process p in Process.GetProcessesByName(me.ProcessName)) if (p.Id != me.Id) pids.Add((uint)p.Id);
        List<IntPtr> found = new List<IntPtr>();
        EnumWindows(delegate(IntPtr h, IntPtr l)
        {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (!pids.Contains(pid)) return true;
            StringBuilder sb = new StringBuilder(64);
            GetWindowText(h, sb, 64);
            if (sb.ToString() == "Покер Офис") found.Add(h);
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // Сообщение «покажись»: повторный запуск приложения поднимает уже открытое окно, даже если оно в трее.
    public static readonly int ShowMessage = RegisterWindowMessage("PokerLAN-show");

    [STAThread]
    static void Main()
    {
        bool first;
        using (Mutex mutex = new Mutex(true, "PokerLAN-single-instance", out first))
        {
            if (!first)
            {
                // окно первой копии может быть скрыто в трее: находим его по процессу и заголовку и просим показаться
                foreach (IntPtr h in OtherWindows()) PostMessage(h, ShowMessage, IntPtr.Zero, IntPtr.Zero);
                return;
            }
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }
}

// Цвета из дизайн-кода (тёмное оформление), приведённые к непрозрачным значениям на фоне окна.
static class Ui
{
    public static readonly Color Bg = Color.FromArgb(28, 28, 30);
    public static readonly Color Fill = Color.FromArgb(54, 54, 58);
    public static readonly Color FillHover = Color.FromArgb(66, 66, 71);
    public static readonly Color Field = Color.FromArgb(20, 20, 22);
    public static readonly Color Separator = Color.FromArgb(58, 58, 62);
    public static readonly Color Label = Color.FromArgb(240, 240, 242);
    public static readonly Color Label2 = Color.FromArgb(152, 152, 159);
    public static readonly Color Blue = Color.FromArgb(10, 132, 255);
    public static readonly Color BlueHover = Color.FromArgb(43, 149, 255);
    public static readonly Color Green = Color.FromArgb(48, 209, 88);
    public static readonly Color Red = Color.FromArgb(255, 69, 58);
    public static readonly Color DangerFill = Color.FromArgb(64, 35, 34);   // красный 16 % поверх фона
    public static readonly Color DangerHover = Color.FromArgb(87, 39, 37);  // красный 26 % поверх фона
    public const string Font = "Segoe UI";

    // Windows 11 сам скругляет углы, рисует рамку и тень окна. На Windows 10 окно рисует рамку само.
    // Номер сборки берём из реестра: без манифеста .NET сообщает устаревшую версию системы.
    public static readonly bool Win11 = DetectWin11();
    static bool DetectWin11()
    {
        try
        {
            object b = Microsoft.Win32.Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion", "CurrentBuildNumber", "0");
            return int.Parse(b.ToString()) >= 22000;
        }
        catch { return false; }
    }

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);
    [StructLayout(LayoutKind.Sequential)] struct Margins { public int L, R, T, B; }
    [DllImport("dwmapi.dll")] static extern int DwmExtendFrameIntoClientArea(IntPtr h, ref Margins m);

    // Окно без системной рамки на Windows 11: скругление, тонкая рамка цвета разделителя и системная тень.
    public static void StyleWindow(IntPtr h)
    {
        if (!Win11) return;
        try
        {
            int round = 2;                                                   // DWMWCP_ROUND
            DwmSetWindowAttribute(h, 33, ref round, 4);
            int border = Separator.R | (Separator.G << 8) | (Separator.B << 16); // COLORREF
            DwmSetWindowAttribute(h, 34, ref border, 4);
            int nc = 2;                                                      // DWMNCRP_ENABLED: тень у окна без рамки
            DwmSetWindowAttribute(h, 2, ref nc, 4);
            Margins m = new Margins { L = 0, R = 0, T = 0, B = 1 };
            DwmExtendFrameIntoClientArea(h, ref m);
        }
        catch { }
    }

    public static GraphicsPath Round(RectangleF r, float radius)
    {
        float d = radius * 2;
        GraphicsPath p = new GraphicsPath();
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }
}

// Кнопка со скруглением: обычная (серая заливка), главная (синяя) или опасная (красный текст).
class RoundButton : Control
{
    public bool Primary;
    public bool Danger;
    public float Radius = 12F;
    bool hover, down;

    public RoundButton()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
        BackColor = Ui.Bg;
        Cursor = Cursors.Hand;
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; down = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { down = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
    protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        g.Clear(Parent != null ? Parent.BackColor : Ui.Bg);
        Color fill = Primary ? (hover ? Ui.BlueHover : Ui.Blue) : Danger ? (hover ? Ui.DangerHover : Ui.DangerFill) : (hover ? Ui.FillHover : Ui.Fill);
        if (!Enabled) fill = Color.FromArgb(40, 40, 43);
        float k = g.DpiX / 96F;
        RectangleF r = new RectangleF(0.5F, 0.5F, Width - 1, Height - 1);
        if (down) r.Inflate(-1, -1);
        using (GraphicsPath p = Ui.Round(r, Radius * k))
        using (SolidBrush b = new SolidBrush(fill))
            g.FillPath(b, p);
        Color text = !Enabled ? Ui.Label2 : (Danger ? Ui.Red : Color.White);
        TextRenderer.DrawText(g, Text, Font, ClientRectangle, text, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
    }
}

// Кнопка окна («свернуть» или «закрыть»): значок-линия, фон появляется при наведении, как у значков в игре.
class WindowButton : Control
{
    public bool Close;
    bool hover;

    public WindowButton()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        Cursor = Cursors.Hand;
    }
    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Ui.Bg);
        float k = g.DpiX / 96F;
        if (hover)
        {
            using (GraphicsPath p = Ui.Round(new RectangleF(0.5F, 0.5F, Width - 1, Height - 1), 8F * k))
            using (SolidBrush b = new SolidBrush(Close ? Ui.DangerHover : Ui.Fill))
                g.FillPath(b, p);
        }
        float cx = Width / 2F, cy = Height / 2F, r = 5F * k;
        using (Pen pen = new Pen(hover ? Color.White : Ui.Label2, 1.6F * k))
        {
            pen.StartCap = LineCap.Round;
            pen.EndCap = LineCap.Round;
            if (Close) { g.DrawLine(pen, cx - r, cy - r, cx + r, cy + r); g.DrawLine(pen, cx + r, cy - r, cx - r, cy + r); }
            else g.DrawLine(pen, cx - r, cy, cx + r, cy);
        }
    }
}

// Меню значка в трее в тёмном оформлении игры.
class DarkColors : ProfessionalColorTable
{
    public override Color ToolStripDropDownBackground { get { return Ui.Bg; } }
    public override Color ImageMarginGradientBegin { get { return Ui.Bg; } }
    public override Color ImageMarginGradientMiddle { get { return Ui.Bg; } }
    public override Color ImageMarginGradientEnd { get { return Ui.Bg; } }
    public override Color MenuBorder { get { return Ui.Separator; } }
    public override Color MenuItemBorder { get { return Ui.Fill; } }
    public override Color MenuItemSelected { get { return Ui.Fill; } }
    public override Color SeparatorDark { get { return Ui.Separator; } }
    public override Color SeparatorLight { get { return Ui.Bg; } }
}
class DarkRenderer : ToolStripProfessionalRenderer
{
    public DarkRenderer() : base(new DarkColors()) { RoundedEdges = false; }
    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        e.TextColor = e.Item.Tag as string == "danger" ? Ui.Red : Ui.Label;
        base.OnRenderItemText(e);
    }
}

// Вопрос «Остановить игру?» в оформлении приложения вместо системного окна Windows.
class ConfirmForm : Form
{
    protected override CreateParams CreateParams
    {
        get { CreateParams cp = base.CreateParams; if (!Ui.Win11) cp.ClassStyle |= 0x00020000; return cp; }
    }
    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); Ui.StyleWindow(Handle); }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (!Ui.Win11) using (Pen p = new Pen(Ui.Separator)) e.Graphics.DrawRectangle(p, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
    }

    public ConfirmForm(string title, string text, string yes)
    {
        // Сетка: поля 24, заголовок 17 / 600, зазор 8, текст, зазор 24, две равные кнопки 44 с зазором 8.
        const int W = 352, H = 188, PAD = 24, GAP = 8, ROW = 44;
        int bw = (W - PAD * 2 - GAP) / 2;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterParent;
        ShowInTaskbar = false;
        BackColor = Ui.Bg;
        ForeColor = Ui.Label;
        AutoScaleMode = AutoScaleMode.None;
        Font = new Font(Ui.Font, 9.75F);
        ClientSize = new Size(W, H);
        KeyPreview = true;

        Label t = new Label();
        t.Text = title;
        t.Font = new Font("Segoe UI Semibold", 12.75F);
        t.ForeColor = Ui.Label;
        t.SetBounds(PAD, PAD - 2, W - PAD * 2, 26);
        Controls.Add(t);

        Label s = new Label();
        s.Text = text;
        s.ForeColor = Ui.Label2;
        s.SetBounds(PAD, PAD + 32, W - PAD * 2, 44); // две строки текста, до кнопок 24
        Controls.Add(s);

        RoundButton no = new RoundButton();
        no.Text = "Отмена";
        no.Font = new Font(Ui.Font, 11.25F, FontStyle.Bold);
        no.SetBounds(PAD, H - PAD - ROW, bw, ROW);
        no.Click += delegate { DialogResult = DialogResult.No; };
        Controls.Add(no);

        RoundButton ok = new RoundButton();
        ok.Text = yes;
        ok.Danger = true;
        ok.Font = new Font(Ui.Font, 11.25F, FontStyle.Bold);
        ok.SetBounds(PAD + bw + GAP, H - PAD - ROW, bw, ROW);
        ok.Click += delegate { DialogResult = DialogResult.Yes; };
        Controls.Add(ok);

        KeyDown += delegate(object o, KeyEventArgs e) { if (e.KeyCode == Keys.Escape) DialogResult = DialogResult.No; };
        float k;
        using (Graphics g = CreateGraphics()) k = g.DpiX / 96F;
        if (k != 1F) Scale(new SizeF(k, k));
    }
}

// Значок приложения: скруглённый квадрат с градиентом и пикой.
class AppIcon : Control
{
    public AppIcon()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.Clear(Ui.Bg);
        RectangleF r = new RectangleF(0.5F, 0.5F, Width - 1, Height - 1);
        using (GraphicsPath p = Ui.Round(r, Width * 16F / 72F))
        using (LinearGradientBrush b = new LinearGradientBrush(r, Color.FromArgb(77, 143, 214), Color.FromArgb(27, 43, 62), 60F))
            g.FillPath(b, p);
        using (Font f = new Font("Segoe UI Symbol", Height * 0.56F, FontStyle.Regular, GraphicsUnit.Pixel))
        using (StringFormat sf = new StringFormat())
        {
            sf.Alignment = StringAlignment.Center;
            sf.LineAlignment = StringAlignment.Center;
            g.DrawString("\u2660", f, Brushes.White, new RectangleF(0, Height * 0.02F, Width, Height), sf);
        }
    }
}

// Название: крупное «ПОКЕР» с разрядкой, под ним мелкое «ОФИС» с линиями по бокам до краёв верхнего слова.
class Wordmark : Control
{
    public Wordmark()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
    }

    // Ширина строки с разрядкой между буквами (после последней буквы разрядки нет).
    static float Measure(Graphics g, string s, Font f, StringFormat sf, float track)
    {
        float w = 0;
        for (int i = 0; i < s.Length; i++) w += g.MeasureString(s.Substring(i, 1), f, 2000, sf).Width + (i < s.Length - 1 ? track : 0);
        return w;
    }

    static void Draw(Graphics g, string s, Font f, Brush b, float x, float y, StringFormat sf, float track)
    {
        for (int i = 0; i < s.Length; i++)
        {
            string ch = s.Substring(i, 1);
            g.DrawString(ch, f, b, x, y, sf);
            x += g.MeasureString(ch, f, 2000, sf).Width + track;
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.SmoothingMode = SmoothingMode.None;
        g.Clear(Ui.Bg);
        float k = g.DpiX / 96F;
        const string top = "ПОКЕР", bottom = "ОФИС";
        using (StringFormat sf = (StringFormat)StringFormat.GenericTypographic.Clone())
        using (Font big = new Font(Ui.Font, 30F * k, FontStyle.Bold, GraphicsUnit.Pixel))
        using (Font small = new Font("Segoe UI Semibold", 12F * k, FontStyle.Regular, GraphicsUnit.Pixel))
        using (SolidBrush white = new SolidBrush(Ui.Label))
        using (SolidBrush dim = new SolidBrush(Ui.Label2))
        using (Pen rule = new Pen(Color.FromArgb(92, 92, 98), Math.Max(1F, (float)Math.Round(k))))
        {
            sf.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces;
            float trackTop = 30F * k * 0.08F, trackBottom = 12F * k * 0.3F;
            float w = Measure(g, top, big, sf, trackTop);
            float x0 = (Width - w) / 2F;
            // у шрифта над заглавными буквами есть пустое поле, поэтому слово приподнято
            Draw(g, top, big, white, x0, -6F * k, sf, trackTop);
            float wb = Measure(g, bottom, small, sf, trackBottom);
            float xb = (Width - wb) / 2F;
            float yb = 33F * k;
            Draw(g, bottom, small, dim, xb, yb, sf, trackBottom);
            float mid = (float)Math.Round(yb + small.GetHeight(g) / 2F + 1F * k);
            float gap = 8F * k;
            g.DrawLine(rule, x0, mid, xb - gap, mid);
            g.DrawLine(rule, xb + wb + gap, mid, x0 + w, mid);
        }
    }
}
// Поле со ссылкой: тёмная заливка, скругление, тонкая линия.
class LinkField : Control
{
    public LinkField()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Ui.Bg);
        float k = g.DpiX / 96F;
        RectangleF r = new RectangleF(0.5F, 0.5F, Width - 1, Height - 1);
        using (GraphicsPath p = Ui.Round(r, 12F * k))
        using (SolidBrush b = new SolidBrush(Ui.Field))
        using (Pen pen = new Pen(Ui.Separator, 1F))
        {
            g.FillPath(b, p);
            g.DrawPath(pen, p);
        }
        Rectangle t = new Rectangle((int)(12 * k), 0, Width - (int)(24 * k), Height);
        TextRenderer.DrawText(g, Text, Font, t, Ui.Label, TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
    }
}

class MainForm : Form
{
    Process server;
    int port;
    bool stopping;
    Label status;
    Label dot;
    Panel links;
    RoundButton openBtn;
    RoundButton stopBtn;
    float k = 1F;
    int S(int v) { return (int)Math.Round(v * k); }

    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);

    NotifyIcon tray;
    bool exiting;     // выход по «Остановить и выйти»: окно закрывается по-настоящему
    bool trayHinted;  // подсказку «работает в фоне» показываем один раз за запуск

    // Без системной рамки окну нужно самому попросить тень, скруглённые углы (Windows 11) и сворачивание с панели задач.
    // На Windows 11 тень, скругление и рамку рисует система; квадратная тень CS_DROPSHADOW торчала бы из-под скруглённых углов.
    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            if (!Ui.Win11) cp.ClassStyle |= 0x00020000; // CS_DROPSHADOW
            cp.Style |= 0x00020000 | 0x00080000;        // WS_MINIMIZEBOX | WS_SYSMENU
            return cp;
        }
    }
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Ui.StyleWindow(Handle);
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        // своя рамка — только на Windows 10: на Windows 11 её обрезали бы скруглённые углы
        if (!Ui.Win11) using (Pen p = new Pen(Ui.Separator)) e.Graphics.DrawRectangle(p, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
    }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Program.ShowMessage) { ShowFromTray(); return; }
        base.WndProc(ref m);
    }

    // ---------- трей ----------
    // Крестик убирает окно в трей: игра продолжает работать. Совсем выключает её только «Остановить и выйти».
    void SetupTray()
    {
        tray = new NotifyIcon();
        tray.Icon = Icon ?? SystemIcons.Application;
        tray.Text = "Покер Офис";
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Renderer = new DarkRenderer();
        menu.ShowImageMargin = false;
        menu.Font = new Font(Ui.Font, 9.75F);
        menu.Padding = new Padding(4);
        ToolStripMenuItem show = new ToolStripMenuItem("Показать окно");
        show.Font = new Font(Ui.Font, 9.75F, FontStyle.Bold);
        show.Click += delegate { ShowFromTray(); };
        ToolStripMenuItem open = new ToolStripMenuItem("Открыть игру");
        open.Click += delegate { OpenGame(); };
        ToolStripMenuItem quit = new ToolStripMenuItem("Остановить и выйти");
        quit.Tag = "danger";
        quit.Click += delegate { ShowFromTray(); RequestExit(); };
        foreach (ToolStripMenuItem it in new[] { show, open, quit }) it.Padding = new Padding(8, 6, 8, 6);
        menu.Items.Add(show);
        menu.Items.Add(open);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(quit);
        tray.ContextMenuStrip = menu;
        tray.MouseClick += delegate(object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) ShowFromTray(); };
        tray.Visible = true;
    }
    void HideToTray()
    {
        Hide();
        if (!trayHinted && tray != null)
        {
            trayHinted = true;
            tray.ShowBalloonTip(4000, "Покер Офис работает", "Игра продолжается. Окно — по значку в трее, выключить — «Остановить и выйти».", ToolTipIcon.None);
        }
    }
    void ShowFromTray()
    {
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }
    void RequestExit()
    {
        bool alive = server != null && !server.HasExited;
        if (alive)
        {
            using (ConfirmForm f = new ConfirmForm("Остановить игру?", "Все игроки будут отключены. Стол сохранится — его можно продолжить при следующем запуске.", "Остановить"))
                if (f.ShowDialog(this) != DialogResult.Yes) return;
        }
        exiting = true;
        Close();
    }

    public MainForm()
    {
        Text = "Покер Офис";
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        AutoScaleMode = AutoScaleMode.None;
        // Сетка окна по дизайн-коду: поля 24 со всех сторон, зазоры из шкалы 4/8/12/16/24,
        // все кнопки и поле ссылки одной высоты 44 и одного радиуса 12.
        const int W = 400, PAD = 24, CW = W - PAD * 2, ROW = 44;
        ClientSize = new Size(W, 416);
        FormBorderStyle = FormBorderStyle.None; // системной рамки Windows нет: окно рисуется целиком в стиле игры
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Ui.Bg;
        ForeColor = Ui.Label;
        Font = new Font(Ui.Font, 9.75F);

        // Свои кнопки окна вместо системных: «свернуть» и «закрыть», 36x32 с радиусом 8, отступ 8 от краёв.
        WindowButton closeBtn = new WindowButton();
        closeBtn.Close = true;
        closeBtn.SetBounds(W - 8 - 36, 8, 36, 32);
        closeBtn.Click += delegate { HideToTray(); };
        Controls.Add(closeBtn);
        WindowButton minBtn = new WindowButton();
        minBtn.SetBounds(W - 8 - 36 - 2 - 36, 8, 36, 32);
        minBtn.Click += delegate { WindowState = FormWindowState.Minimized; };
        Controls.Add(minBtn);

        AppIcon icon = new AppIcon();
        icon.SetBounds((W - 72) / 2, PAD, 72, 72);
        Controls.Add(icon);

        Wordmark title = new Wordmark();
        title.SetBounds(0, 108, W, 56);
        Controls.Add(title);

        // Окно без рамки перетаскивается за любое свободное место, значок и название.
        MouseEventHandler drag = delegate(object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) { ReleaseCapture(); SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero); } };
        MouseDown += drag;
        icon.MouseDown += drag;
        title.MouseDown += drag;

        Panel statusRow = new Panel();
        statusRow.SetBounds(0, 168, W, 20);
        Controls.Add(statusRow);

        dot = new Label();
        dot.Text = "\u25CF";
        dot.Font = new Font(Ui.Font, 8F);
        dot.ForeColor = Ui.Label2;
        dot.AutoSize = true;
        statusRow.Controls.Add(dot);

        status = new Label();
        status.Text = "Запускаем игру…";
        status.ForeColor = Ui.Label2;
        status.AutoSize = true;
        statusRow.Controls.Add(status);
        statusRow.Layout += delegate
        {
            int w = dot.Width + status.Width;
            dot.Location = new Point((statusRow.Width - w) / 2, (statusRow.Height - dot.Height) / 2 + 1);
            status.Location = new Point(dot.Right, (statusRow.Height - status.Height) / 2);
        };

        Label caption = new Label();
        caption.Text = "Ссылка для друзей";
        caption.ForeColor = Ui.Label2;
        caption.Font = new Font(Ui.Font, 8.25F);
        caption.SetBounds(PAD + 2, 212, CW, 16);
        Controls.Add(caption);

        links = new Panel();
        links.SetBounds(PAD, 236, CW, ROW);
        Controls.Add(links);

        openBtn = new RoundButton();
        openBtn.Text = "Открыть игру";
        openBtn.Primary = true;
        openBtn.Font = new Font(Ui.Font, 11.25F, FontStyle.Bold);
        openBtn.SetBounds(PAD, 296, CW, ROW);
        openBtn.Enabled = false;
        openBtn.Click += delegate { OpenGame(); };
        Controls.Add(openBtn);

        stopBtn = new RoundButton();
        stopBtn.Text = "Остановить и выйти";
        stopBtn.Danger = true;
        stopBtn.Font = new Font(Ui.Font, 11.25F, FontStyle.Bold);
        stopBtn.SetBounds(PAD, 348, CW, ROW);
        stopBtn.Click += delegate { RequestExit(); };
        Controls.Add(stopBtn);
        // Размеры выше заданы для масштаба 100 %; под масштаб экрана окно растягивается целиком.
        using (Graphics g = CreateGraphics()) k = g.DpiX / 96F;
        if (k != 1F) Scale(new SizeF(k, k));

        SetupTray();
        Shown += delegate { StartServer(); };
        FormClosing += OnClosing;
    }

    // Сервер (Node.js с игрой внутри) хранится в ресурсах exe и распаковывается при первом запуске новой версии.
    // Имя файла всегда одно и то же: брандмауэр и антивирус запоминают разрешение по пути к программе,
    // и с новым именем после каждого обновления сеть пришлось бы разрешать заново.
    string ExtractServer()
    {
        Assembly asm = Assembly.GetExecutingAssembly();
        using (Stream res = asm.GetManifestResourceStream("poker-server.exe"))
        {
            if (res == null) throw new Exception("В приложении нет встроенного сервера.");
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PokerLAN");
            Directory.CreateDirectory(dir);
            string target = Path.Combine(dir, "poker-server.exe");
            string versionFile = Path.Combine(dir, "poker-server.version");
            string version = res.Length.ToString("x") + "-" + File.GetLastWriteTimeUtc(Application.ExecutablePath).Ticks.ToString("x");
            if (File.Exists(target) && File.Exists(versionFile) && File.ReadAllText(versionFile) == version) return target;
            foreach (string old in Directory.GetFiles(dir, "poker-server-*.exe"))
            {
                try { File.Delete(old); } catch { }
            }
            string tmp = target + ".tmp";
            using (FileStream f = File.Create(tmp)) res.CopyTo(f);
            if (File.Exists(target)) File.Delete(target);
            File.Move(tmp, target);
            File.WriteAllText(versionFile, version);
            return target;
        }
    }
    void StartServer()
    {
        try
        {
            string exe = ExtractServer();
            ProcessStartInfo psi = new ProcessStartInfo(exe);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardInput = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.EnvironmentVariables["POKER_LAUNCHER"] = "1";
            server = new Process();
            server.StartInfo = psi;
            server.EnableRaisingEvents = true;
            server.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) OnLine(e.Data); };
            server.ErrorDataReceived += delegate { };
            server.Exited += delegate { if (!stopping) OnUi(delegate { SetStatus("Игра неожиданно остановилась. Перезапустите приложение.", Ui.Red); openBtn.Enabled = false; ShowFromTray(); }); };
            server.Start();
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            SetStatus("Не удалось запустить игру: " + ex.Message, Ui.Red);
        }
    }

    void OnLine(string line)
    {
        if (line.StartsWith("@@READY "))
        {
            Match p = Regex.Match(line, "\"port\":(\\d+)");
            List<string[]> addrs = new List<string[]>();
            foreach (Match m in Regex.Matches(line, "\\{\"name\":\"((?:[^\"\\\\]|\\\\.)*)\",\"address\":\"([^\"]+)\"\\}"))
            {
                addrs.Add(new string[] { Regex.Unescape(m.Groups[1].Value), m.Groups[2].Value });
            }
            int prt = int.Parse(p.Groups[1].Value);
            OnUi(delegate { OnReady(prt, addrs); });
        }
        else if (line.StartsWith("@@ERROR "))
        {
            string msg = line.Substring(8);
            OnUi(delegate { SetStatus(msg, Ui.Red); });
        }
    }

    void OnReady(int prt, List<string[]> addrs)
    {
        port = prt;
        SetStatus("Игра запущена", Ui.Green);
        openBtn.Enabled = true;
        links.Controls.Clear();
        int y = 0;
        if (addrs.Count == 0)
        {
            Label none = new Label();
            none.Text = "Сеть не найдена. Подключитесь к Wi-Fi или кабелю и перезапустите приложение. На этом компьютере игра работает.";
            none.ForeColor = Ui.Red;
            none.SetBounds(0, 0, links.Width, S(60));
            links.Controls.Add(none);
        }
        int rows = Math.Min(addrs.Count, 2);
        for (int i = 0; i < rows; i++)
        {
            string url = "http://" + addrs[i][1] + ":" + port;
            LinkField box = new LinkField();
            box.Text = url;
            box.Font = new Font("Consolas", 9.75F);
            box.SetBounds(0, y, links.Width - S(120), S(44));
            links.Controls.Add(box);
            RoundButton copy = new RoundButton();
            copy.Text = "Скопировать";
            copy.SetBounds(links.Width - S(112), y, S(112), S(44));
            copy.Click += delegate(object s, EventArgs e)
            {
                try { Clipboard.SetText(url); ((RoundButton)s).Text = "Скопировано"; } catch { }
            };
            links.Controls.Add(copy);
            y += S(44);
            if (addrs.Count > 1)
            {
                Label net = new Label();
                net.Text = addrs[i][0];
                net.ForeColor = Ui.Label2;
                net.Font = new Font(Ui.Font, 8F);
                net.SetBounds(S(2), y + S(2), links.Width, S(15));
                links.Controls.Add(net);
                y += S(17);
            }
            y += S(8);
        }
        // Кнопки встают сразу под ссылками, окно подстраивается по высоте.
        int rowsHeight = Math.Max(y - S(8), S(44));   // последний зазор после ряда не считается
        int shift = links.Top + rowsHeight + S(16) - openBtn.Top;
        links.Height = rowsHeight;
        openBtn.Top += shift;
        stopBtn.Top += shift;
        ClientSize = new Size(ClientSize.Width, ClientSize.Height + shift);
        OpenGame();
    }

    void OpenGame()
    {
        if (port == 0) return;
        try { Process.Start("http://localhost:" + port); } catch { }
    }

    void SetStatus(string text, Color color)
    {
        status.Text = text;
        status.ForeColor = color == Ui.Green ? Ui.Label2 : color;
        dot.ForeColor = color;
        status.Parent.PerformLayout();
    }

    void OnUi(MethodInvoker action)
    {
        if (IsDisposed) return;
        try { BeginInvoke(action); } catch { }
    }

    void OnClosing(object sender, FormClosingEventArgs e)
    {
        // Alt+F4 и «Закрыть окно» на панели задач тоже убирают в трей; выход — только кнопкой.
        // Выключение Windows и диспетчер задач закрывают приложение сразу.
        if (!exiting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            HideToTray();
            return;
        }
        stopping = true;
        if (tray != null) { tray.Visible = false; tray.Dispose(); }
        if (server != null)
        {
            try { server.StandardInput.Close(); } catch { }
            try { if (!server.WaitForExit(1500)) server.Kill(); } catch { }
        }
    }
}
