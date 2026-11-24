import { createInterface } from 'node:readline';

/**
 * Terminal input for operator scripts. On an interactive terminal, secrets are typed without
 * echo. When stdin is piped (automation), lines are read in order.
 */
export class Prompt {
  private readonly lines: string[] = [];
  private readonly waiting: ((line: string) => void)[] = [];
  private muted = false;
  private readonly readline;

  constructor() {
    this.readline = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY,
    });
    const rl = this.readline as unknown as {
      _writeToOutput: (text: string) => void;
      output: NodeJS.WritableStream;
    };
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (text: string) => {
      if (!this.muted || text.includes('\n') || text.includes('\r'))
        write(this.muted ? '\n' : text);
    };
    this.readline.on('line', (line) => {
      const resolve = this.waiting.shift();
      if (resolve) resolve(line);
      else this.lines.push(line);
    });
  }

  ask(question: string): Promise<string> {
    process.stdout.write(question);
    return this.next();
  }

  async askSecret(question: string): Promise<string> {
    process.stdout.write(question);
    this.muted = true;
    try {
      return await this.next();
    } finally {
      this.muted = false;
    }
  }

  close(): void {
    this.readline.close();
  }

  private next(): Promise<string> {
    const line = this.lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise((resolve, reject) => {
      this.waiting.push(resolve);
      this.readline.once('close', () => {
        reject(new Error('Input ended before all answers were given.'));
      });
    });
  }
}
