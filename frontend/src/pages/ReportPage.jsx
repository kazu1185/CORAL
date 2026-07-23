import React, { useState, useCallback, useEffect } from 'react';
import { api } from '../api/client';
import { taxRateLabel } from '../utils/constants';
import { todayStr } from '../utils/date';
import './ReportPage.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8080/api/v1';

/**
 * 売上レポートページ
 * 収入実績・予測表PDFの出力機能を提供する
 */
export default function ReportPage() {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const defaultCutoff = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const [month, setMonth] = useState(defaultMonth);
  const [cutoff, setCutoff] = useState(defaultCutoff);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * PDF生成APIを呼び出し、ブラウザの新しいタブでPDFを表示する
   * apiRequestはJSONパースするため、PDFバイナリは直接fetchで取得
   */
  const handleDownload = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('pms_token');
      const url = `${API_BASE}/reports/income-pdf?month=${month}&cutoff=${cutoff}`;

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        // エラーレスポンスはJSONの可能性があるので試行
        const text = await response.text();
        try {
          const json = JSON.parse(text);
          throw new Error(json.error || 'PDF生成に失敗しました');
        } catch (e) {
          if (e.message !== 'PDF生成に失敗しました') {
            throw new Error(`PDF生成に失敗しました (${response.status})`);
          }
          throw e;
        }
      }

      // PDFバイナリをBlobに変換してブラウザで表示
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');

      // メモリリーク防止: 少し待ってからrevokeする
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [month, cutoff]);

  return (
    <div className="report-page">
      <div className="report-page__header">
        <h1 className="report-page__title">
          <span className="material-symbols-outlined report-page__icon">bar_chart</span>
          売上レポート
        </h1>
      </div>

      <div className="report-page__content">
        {/* 日計（その日の締め用。フロント業務で最初に見るので先頭に置く） */}
        <DailyReport />

        {/* 収入実績・予測表 */}
        <div className="report-card">
          <div className="report-card__header">
            <span className="material-symbols-outlined report-card__icon">description</span>
            <div>
              <h2 className="report-card__title">収入実績・予測表（日別・前年比）</h2>
              <p className="report-card__desc">日別の売上・稼働率・入数を前年同月と比較するA4横PDF帳票</p>
            </div>
          </div>

          <div className="report-card__form">
            <div className="report-card__field">
              <label className="report-card__label" htmlFor="report-month">対象年月</label>
              <input
                id="report-month"
                type="month"
                className="report-card__input"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>

            <div className="report-card__field">
              <label className="report-card__label" htmlFor="report-cutoff">業績日付</label>
              <input
                id="report-cutoff"
                type="date"
                className="report-card__input"
                value={cutoff}
                onChange={(e) => setCutoff(e.target.value)}
              />
              <span className="report-card__hint">この日以前 = 実績、以降 = 予測（グレー背景）</span>
            </div>

            <button
              className="report-card__btn"
              onClick={handleDownload}
              disabled={loading}
            >
              <span className="material-symbols-outlined">{loading ? 'hourglass_empty' : 'picture_as_pdf'}</span>
              {loading ? 'PDF生成中...' : 'PDF出力'}
            </button>
          </div>

          {error && (
            <div className="report-card__error">
              <span className="material-symbols-outlined">error_outline</span>
              {error}
            </div>
          )}
        </div>

        <ProductSalesReport />
      </div>
    </div>
  );
}

/**
 * 日計（その日の締め作業用）
 *
 * 売上・入金・CI/CO・稼働・未収を1画面で確認する。
 * 売上の集計定義は収入実績・予測表と揃えてある（物販の即売を含む）
 */
function DailyReport() {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get(`/reports/daily?date=${date}`));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  return (
    <div className="report-card">
      <div className="report-card__header">
        <span className="material-symbols-outlined report-card__icon">today</span>
        <div>
          <h2 className="report-card__title">日計</h2>
          <p className="report-card__desc">その日の売上・入金・稼働の締め用サマリー</p>
        </div>
      </div>

      <div className="report-card__form">
        <div className="report-card__field">
          <label className="report-card__label" htmlFor="daily-date">対象日</label>
          <input id="daily-date" type="date" className="report-card__input"
            value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>

      {error && (
        <div className="report-card__error">
          <span className="material-symbols-outlined">error_outline</span>
          {error}
        </div>
      )}

      {loading && <p className="report-ps__empty">集計中...</p>}

      {!loading && data && (
        <div className="report-ps">
          <div className="report-daily__kpis">
            <Kpi label="売上合計" value={`¥${data.sales.total.toLocaleString()}`} strong />
            <Kpi label="入金合計" value={`¥${data.payment_total.toLocaleString()}`} />
            <Kpi label="稼働" value={`${data.rooms.sold} / ${data.rooms.physical} 室（${data.rooms.occupancy}%）`} />
            <Kpi label="CI / CO" value={`${data.movements.checkin_count} / ${data.movements.checkout_count} 件`} />
            {/* 在室中の未収は回収漏れの発見用。0でない場合だけ強調する */}
            <Kpi label="在室中の未収" value={`¥${data.unpaid_in_house.toLocaleString()}`}
              alert={data.unpaid_in_house > 0} />
            {data.refund_total !== 0 && (
              <Kpi label="返金" value={`¥${data.refund_total.toLocaleString()}`} />
            )}
          </div>

          <div className="report-ps__grid">
            <ReportTable
              title="売上の内訳"
              head={['項目', '金額']}
              rows={[
                ['宿泊', `¥${data.sales.room.toLocaleString()}`],
                ['物販（部屋付け）', `¥${data.sales.goods_charged.toLocaleString()}`],
                ['物販（即売）', `¥${data.sales.goods_immediate.toLocaleString()}`],
                ['その他・割引', `¥${data.sales.other.toLocaleString()}`],
                ['合計', `¥${data.sales.total.toLocaleString()}`],
                ['（内消費税）', `¥${data.sales.tax_amount.toLocaleString()}`],
                ['（内宿泊税）', `¥${data.sales.accommodation_tax.toLocaleString()}`],
              ]}
            />
            <ReportTable
              title="入金の内訳（決済方法別）"
              head={['決済方法', '金額']}
              rows={data.payments.map(p => [
                // payment_method_id が NULL の入金はOTA事前決済等（決済方法を持たない行）
                p.payment_method_id ? p.method_name : '未設定（OTA事前決済等）',
                `¥${Number(p.amount).toLocaleString()}`,
              ])}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, strong = false, alert = false }) {
  return (
    <div className="report-daily__kpi">
      <div className="report-daily__kpi-label">{label}</div>
      <div className={`report-daily__kpi-value ${strong ? 'report-daily__kpi-value--strong' : ''} ${alert ? 'report-daily__kpi-value--alert' : ''}`}>
        {value}
      </div>
    </div>
  );
}

/**
 * 物販レポート（商品別・税率別・即売/部屋付け別・支払方法別）
 *
 * 集計元は product_sales。部屋付け分は予約の請求額（reservation_charges）にも
 * 計上されているため、上の収入実績表と足し合わせないこと（二重計上になる）。
 * その注意は画面にも出している
 */
function ProductSalesReport() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get(`/reports/products?from=${from}&to=${to}`));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const saleTypeLabel = { immediate: '即売', room_charge: '部屋付け' };

  return (
    <div className="report-card">
      <div className="report-card__header">
        <span className="material-symbols-outlined report-card__icon">local_mall</span>
        <div>
          <h2 className="report-card__title">物販売上</h2>
          <p className="report-card__desc">商品別・税率別・即売/部屋付け別の集計（取消分は除く）</p>
        </div>
      </div>

      <div className="report-card__form">
        <div className="report-card__field">
          <label className="report-card__label" htmlFor="ps-from">開始日</label>
          <input id="ps-from" type="date" className="report-card__input" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="report-card__field">
          <label className="report-card__label" htmlFor="ps-to">終了日</label>
          <input id="ps-to" type="date" className="report-card__input" value={to} onChange={e => setTo(e.target.value)} />
        </div>
      </div>

      {error && (
        <div className="report-card__error">
          <span className="material-symbols-outlined">error_outline</span>
          {error}
        </div>
      )}

      {loading && <p className="report-ps__empty">集計中...</p>}

      {!loading && data && (
        data.summary.total_amount === 0 ? (
          <p className="report-ps__empty">この期間の物販売上はありません</p>
        ) : (
          <div className="report-ps">
            <div className="report-ps__total">
              合計 <strong>¥{data.summary.total_amount.toLocaleString()}</strong>
              <span className="report-ps__total-tax">（内消費税 ¥{data.summary.tax_amount.toLocaleString()}）</span>
            </div>

            <div className="report-ps__grid">
              <ReportTable
                title="商品別"
                head={['商品', '税率', '数量', '金額']}
                rows={data.by_product.map(p => [
                  p.product_name, taxRateLabel(p.tax_rate), Number(p.quantity), `¥${Number(p.amount).toLocaleString()}`,
                ])}
              />
              <ReportTable
                title="税率別"
                head={['税率', '対象額', '内消費税']}
                rows={data.by_tax_rate.map(t => [
                  taxRateLabel(t.tax_rate), `¥${Number(t.amount).toLocaleString()}`, `¥${Number(t.tax_amount).toLocaleString()}`,
                ])}
              />
              <ReportTable
                title="販売形態別"
                head={['形態', '数量', '金額']}
                rows={data.by_sale_type.map(t => [
                  saleTypeLabel[t.sale_type] || t.sale_type, Number(t.quantity), `¥${Number(t.amount).toLocaleString()}`,
                ])}
              />
              <ReportTable
                title="支払方法別（即売のみ）"
                head={['支払方法', '数量', '金額']}
                rows={data.by_payment_method.map(p => [
                  p.method_name || '-', Number(p.quantity), `¥${Number(p.amount).toLocaleString()}`,
                ])}
              />
            </div>

            <p className="report-ps__note">
              ※ここの金額は収入実績・予測表の「売上金額」にも含まれています（同表の「物販」列と一致）。
              合算すると二重計上になります。
            </p>
          </div>
        )
      )}
    </div>
  );
}

function ReportTable({ title, head, rows }) {
  return (
    <div className="report-ps__block">
      <div className="report-ps__block-title">{title}</div>
      <table className="report-ps__table">
        <thead>
          <tr>{head.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={j === 0 ? '' : 'report-ps__num'}>{c}</td>)}</tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={head.length} className="report-ps__empty-cell">データなし</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** 当月1日（'YYYY-MM-01'）。utils/date.js に月初を返す関数が無いためここで組む */
function monthStart() {
  return todayStr().slice(0, 8) + '01';
}
