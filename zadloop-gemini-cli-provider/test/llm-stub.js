// The host supplies this peer dependency; only its adapter base is needed here.
export class LlmAdapter {
  imageRequestTarget(_provider, _model, attachment) {
    return { width: attachment.width, height: attachment.height, maxBytes: attachment.bytes }
  }
}
