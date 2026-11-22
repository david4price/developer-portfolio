/** One item served by the __title__ API module (`GET /api/v1/__slug__/items`). */
export interface __Pascal__Item {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface __Pascal__ItemsResponse {
  readonly items: readonly __Pascal__Item[];
}
