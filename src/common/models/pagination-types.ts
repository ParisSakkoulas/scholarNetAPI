/** What a paginated endpoint receives from the frontend's app-generic-table. */
export interface PageQuery {
  page: number;
  pageSize: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

export interface Page<T> {
  data: T[];
  total: number;
}
