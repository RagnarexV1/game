// Electron entry: serves the Vite build (dist/) over a custom app:// protocol
// so module scripts and Phaser's XHR asset loading behave like on a web server.
const { app, BrowserWindow, protocol, net } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const DIST = path.join(__dirname, '..', 'dist')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 960,
    useContentSize: true,
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Ragnarex',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.setMenu(null)

  // F11 toggles fullscreen, F12 opens devtools
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen())
      event.preventDefault()
    } else if (input.key === 'F12') {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  win.loadURL('app://game/index.html')
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url)
    const filePath = path.normalize(path.join(DIST, decodeURIComponent(pathname)))
    // Block path traversal outside dist/
    if (!filePath.startsWith(DIST + path.sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(filePath).toString()).catch(() => {
      console.error('app:// not found:', pathname)
      return new Response('Not found', { status: 404 })
    })
  })

  createWindow()
})

app.on('window-all-closed', () => app.quit())
