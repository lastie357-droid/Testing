/**
 * Decode the compressed screen:update envelope sent by Android.
 *
 * The backend deliberately forwards compressed frames unchanged on the
 * realtime path so Node does not synchronously gunzip and parse every frame.
 */
export async function decodeScreenFrame(frame) {
  if (!frame?.compressed || typeof frame.data !== 'string') return frame;

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('GZIP decompression is not supported by this browser');
  }

  const binary = atob(frame.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();

  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  const decoded = JSON.parse(new TextDecoder().decode(output));
  return {
    ...decoded,
    deviceId: frame.deviceId || decoded.deviceId,
    sequence: frame.sequence ?? decoded.sequence,
    capturedAt: decoded.capturedAt ?? frame.capturedAt ?? frame.ts,
    receivedAt: frame.receivedAt,
  };
}