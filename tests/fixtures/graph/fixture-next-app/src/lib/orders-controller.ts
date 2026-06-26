import { OrdersService } from "./orders-service";

export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  index(): string[] {
    return this.service.listOrders();
  }
}