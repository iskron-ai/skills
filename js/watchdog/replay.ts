// Кольцо моста, отданное прицепившемуся сторожу (граф nks-dev: #5671): мост
// кладёт в кольцо hello каждого переоткрытия сокета и называет в attached
// число кадров кольца (buffered). «Задним числом» зовёт делателя читать,
// поэтому строка прицепления ждёт эти кадры и считает лишь напечатанные;
// hello из кольца — один, последний.

export class RingReplay {
  /** Сколько напечатано строкой делателю из кадров кольца. */
  printed = 0;
  /** Последний hello кольца, сырой строкой. */
  hello = "";
  private left = 0;
  private release: (() => void) | null = null;

  /** Новое прицепление: ворота строки прицепления открываются, когда кольцо отдано или вышел срок. */
  start(buffered: number, waitMs: number): Promise<void> {
    this.end();
    this.left = buffered;
    this.printed = 0;
    this.hello = "";
    let done = (): void => {};
    const ready = new Promise<void>((r) => (done = r));
    this.release = done;
    // Без unref: очередь вывода ждёт этих ворот, и процесс не должен кончиться молча за ними.
    setTimeout(() => this.release === done && this.end(), waitMs);
    return ready;
  }

  /** Пришёл кадр: true — он из кольца. */
  next(): boolean {
    if (this.left <= 0) return false;
    this.left--;
    return true;
  }

  /** Событие разобрано: кольцо отдано — ворота открываются. */
  settle(): void {
    if (this.release && this.left === 0) this.end();
  }

  /** Кадров кольца больше не ждать: последнее слово сторожа не стоит за воротами. */
  end(): void {
    this.left = 0;
    this.release?.();
    this.release = null;
  }
}
