import test from 'node:test';
import assert from 'node:assert/strict';
import { onFileDrop } from '../../../F.Site/Frontend/frontend-bootstrap/js/file-drop.js';

test('file drop tracks drag state and delivers only the first file', () => {
  const handlers = {};
  const classes = new Set();
  const drop = {
    addEventListener: (name, handler) => { handlers[name] = handler; },
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
  };
  const received = [];
  onFileDrop(drop, (file) => received.push(file));
  let prevented = 0;
  const event = (files = []) => ({ preventDefault: () => { prevented++; }, dataTransfer: { files } });
  handlers.dragover(event());
  assert.ok(classes.has('is-over'));
  handlers.dragleave(event());
  assert.ok(!classes.has('is-over'));
  handlers.dragover(event());
  handlers.drop(event(['first', 'second']));
  handlers.drop(event());
  assert.deepEqual(received, ['first']);
  assert.ok(!classes.has('is-over'));
  assert.equal(prevented, 5);
});
