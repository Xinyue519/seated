export const price = (level: number) => '$'.repeat(level);

export const guests = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`;

export function hash(input: string): number {
  let h = 7;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) % 100003;
  return h;
}

let counter = 0;
export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');
