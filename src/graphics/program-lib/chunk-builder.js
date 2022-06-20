// helper class for combining shader chunks together
// ensures every chunk ends with a new line otherwise shaders can be ill-formed
class ChunkBuilder {
    code = '';

    append(...chunks) {
        chunks.forEach((chunk) => {
            if (chunk.endsWith('\n')) {
                this.code += chunk;
            } else {
                this.code += chunk + '\n';
            }
        });
    }
}

export { ChunkBuilder };
