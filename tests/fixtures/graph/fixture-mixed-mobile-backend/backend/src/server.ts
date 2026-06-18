import { ApiService } from "./ApiService.js";

const api = new ApiService();

export function startServer() {
  return api.getHealth();
}