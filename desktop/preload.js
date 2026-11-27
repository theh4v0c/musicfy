'use strict';
/* The only bridge between the page and the shell. No Node in the renderer: the page gets
 * four calls, none of which can touch a file it was not handed. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicfyDesktop', {
  platform: process.platform,
  version: process.versions.electron,
  pickFolder: () => ipcRenderer.invoke('musicfy:pick-folder'),
  reveal: (which) => ipcRenderer.invoke('musicfy:reveal', which),
  info: () => ipcRenderer.invoke('musicfy:info'),
  mode: () => ipcRenderer.invoke('musicfy:mode'),
  connect: (url) => ipcRenderer.invoke('musicfy:connect', url),
  disconnect: () => ipcRenderer.invoke('musicfy:disconnect'),
  setPlaying: (playing) => ipcRenderer.send('musicfy:playing', !!playing),
});
