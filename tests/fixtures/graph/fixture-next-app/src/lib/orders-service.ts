import { OrdersRepository } from "./orders-repository";

export class OrdersService {
  constructor(private readonly repository: OrdersRepository) {}

  listOrders(): string[] {
    return this.repository.list();
  }
}