import type { ItemInstance } from '../types'

export class FloorItem {
  constructor(
    public x: number,
    public y: number,
    public item: ItemInstance,
  ) {}
}
