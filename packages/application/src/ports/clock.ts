export interface ClockPort {
  now(): string;
}
export interface IdPort {
  create(): string;
}
