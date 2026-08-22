"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  noun = "itens",
  pageSizeOptions = [12, 25, 50],
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  noun?: string;
  pageSizeOptions?: number[];
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const first = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const last = Math.min(safePage * pageSize, total);

  if (total === 0) return null;

  return (
    <nav className="list-pagination" aria-label={`Paginação de ${noun}`}>
      <span className="pagination-range">Exibindo <strong>{first}–{last}</strong> de <strong>{total}</strong> {noun}</span>
      <label className="pagination-size">Por página
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <div className="pagination-controls">
        <button type="button" onClick={() => onPageChange(safePage - 1)} disabled={safePage === 1} aria-label="Página anterior"><ChevronLeft size={17} /></button>
        <span>Página <strong>{safePage}</strong> de {totalPages}</span>
        <button type="button" onClick={() => onPageChange(safePage + 1)} disabled={safePage === totalPages} aria-label="Próxima página"><ChevronRight size={17} /></button>
      </div>
    </nav>
  );
}
