export const name = "sigly";

export function greet(subject = "world"): string {
  return `Hello, ${subject} from ${name}.`;
}
