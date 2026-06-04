export type ProductGraphLoader = () => Promise<void>;

export function requestProductGraphLoad(loadProductGraph: ProductGraphLoader): void {
  void loadProductGraph().catch(() => {
    // The store already publishes productGraphError for the visible UI state.
  });
}
