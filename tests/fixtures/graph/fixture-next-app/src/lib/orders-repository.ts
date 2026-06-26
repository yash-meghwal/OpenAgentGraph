import type { OrdersContract } from "./orders-contract";

export class OrdersRepository implements OrdersContract {
  list(): string[] {
    return [];
  }
}