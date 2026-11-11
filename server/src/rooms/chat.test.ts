import { afterEach, describe, expect, it } from 'vitest';
import { accountFor, collect, joinGrove, sleep, startServer, waitFor, type TestServer } from './testHelpers';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

/** A server with Alice and Bob in the grove; `heard` and `echoed` collect the chat Bob and Alice receive. */
async function aliceAndBob() {
  server = await startServer();
  const alice = await joinGrove(server.url, (await accountFor(server.store, 'Alice')).token);
  const bob = await joinGrove(server.url, (await accountFor(server.store, 'Bob')).token);
  await waitFor(() => alice.room.state.players.size === 2);
  return { alice: alice.room, heard: collect(bob.room, 'chat'), echoed: collect(alice.room, 'chat') };
}

describe('chat', () => {
  it('broadcasts a line to everyone in the room, sender included', async () => {
    const { alice, heard, echoed } = await aliceAndBob();
    alice.send('chat', { text: 'hello' });
    await waitFor(() => heard.length === 1 && echoed.length === 1);
    expect(heard).toEqual([{ from: 'Alice', text: 'hello' }]);
    expect(echoed).toEqual([{ from: 'Alice', text: 'hello' }]);
  });

  it('cleans the text: control characters and extra whitespace go', async () => {
    const { alice, heard } = await aliceAndBob();
    alice.send('chat', { text: '  hi\n\u0007 there ' });
    await waitFor(() => heard.length === 1);
    expect(heard[0]).toEqual({ from: 'Alice', text: 'hi there' });
  });

  it('cuts a long message to 200 characters', async () => {
    const { alice, heard } = await aliceAndBob();
    alice.send('chat', { text: 'a'.repeat(5000) });
    await waitFor(() => heard.length === 1);
    expect(heard[0].text).toBe('a'.repeat(200));
  });

  it('passes markup through as plain text (the client renders it as text)', async () => {
    const { alice, heard } = await aliceAndBob();
    alice.send('chat', { text: '<img src=x onerror=alert(1)>' });
    await waitFor(() => heard.length === 1);
    expect(heard[0].text).toBe('<img src=x onerror=alert(1)>');
  });

  it('drops empty and non-string text, without using up the rate limit', async () => {
    const { alice, heard } = await aliceAndBob();
    for (const message of [{ text: '' }, { text: '   \n' }, { text: 42 }, { text: null }, {}, 'hello', null]) {
      alice.send('chat', message);
    }
    alice.send('chat', { text: 'still here' });
    await waitFor(() => heard.length > 0);
    await sleep(100);
    expect(heard).toEqual([{ from: 'Alice', text: 'still here' }]);
  });

  it('drops a second message within 1 s, and accepts the next one after 1 s', async () => {
    const { alice, heard } = await aliceAndBob();
    alice.send('chat', { text: 'one' });
    alice.send('chat', { text: 'two' });
    await waitFor(() => heard.length === 1);
    await sleep(1050);
    alice.send('chat', { text: 'three' });
    await waitFor(() => heard.length === 2);
    expect(heard.map((m) => m.text)).toEqual(['one', 'three']);
  });
});
