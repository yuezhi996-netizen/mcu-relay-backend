import type { TablePaginationConfig } from "antd";

export const createTablePagination = (pageSize: number): TablePaginationConfig => ({
  defaultPageSize: pageSize,
  showSizeChanger: true,
  pageSizeOptions: [10, 20, 50],
  showTotal: (total: number, range: readonly [number, number]) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
  locale: {
    items_per_page: "条/页",
    jump_to: "跳至",
    jump_to_confirm: "确定",
    page: "页",
    prev_page: "上一页",
    next_page: "下一页",
    prev_5: "向前 5 页",
    next_5: "向后 5 页",
    prev_3: "向前 3 页",
    next_3: "向后 3 页",
    page_size: "每页条数"
  }
});
