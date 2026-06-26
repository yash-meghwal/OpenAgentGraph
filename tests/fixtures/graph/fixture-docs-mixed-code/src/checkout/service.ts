import { CheckoutRepository } from "./repository.js";

export class CheckoutService {
  constructor(private readonly repository: CheckoutRepository) {}

  run(): void {
    this.repository.run();
  }
}