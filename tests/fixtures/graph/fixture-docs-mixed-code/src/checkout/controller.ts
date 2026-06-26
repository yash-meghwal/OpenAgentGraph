import { CheckoutService } from "./service.js";

export class CheckoutController {
  constructor(private readonly service: CheckoutService) {}

  handle(): void {
    this.service.run();
  }
}