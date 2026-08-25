// Property inspector: a single dropdown choosing the command for this key.
/* global WebSocket */

let ws = null;
let piUUID = null;
const select = document.getElementById('command');

function connectElgatoStreamDeckSocket(port, uuid, registerEvent, info, actionInfo) {
  piUUID = uuid;
  const parsed = JSON.parse(actionInfo);
  const settings = (parsed.payload && parsed.payload.settings) || {};
  if (settings.command) select.value = settings.command;

  ws = new WebSocket('ws://127.0.0.1:' + port);
  ws.onopen = () => ws.send(JSON.stringify({ event: registerEvent, uuid }));
}

select.addEventListener('change', () => {
  if (ws && ws.readyState === 1) {
    ws.send(
      JSON.stringify({
        event: 'setSettings',
        context: piUUID,
        payload: { command: select.value },
      })
    );
  }
});

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
