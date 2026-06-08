const { app, BrowserWindow, Tray, nativeImage, Menu } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development';

let tray = null;
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 340,
    height: 420,
    show: false, // Don't show until tray click
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const url = isDev ? 'http://localhost:3000' : `file://${path.join(__dirname, '../out/index.html')}`;
  mainWindow.loadURL(url);

  // Hide the window when it loses focus
  mainWindow.on('blur', () => {
    if (!isDev) {
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Create a simple blank icon for now (or a generated native image)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Groundhog Context Engine');
  
  tray.on('click', (event, bounds) => {
    const { x, y } = bounds;
    const { height, width } = mainWindow.getBounds();
    
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      // Position logic (bottom right generally for windows, top right for mac)
      const yPosition = process.platform === 'darwin' ? y : y - height;
      mainWindow.setBounds({
        x: x - width / 2,
        y: yPosition,
        height,
        width,
      });
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
