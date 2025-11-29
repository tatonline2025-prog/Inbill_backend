import { Request, Response } from "express";

const K_MAX_SAFE = 9;
const TOP_B = 50000;

interface Item {
  id: number;
  val: number;
}

interface Combo {
  sum: number;
  items: Item[];
}

function getCombosWithSubset(
  list: Item[],
  k: number,
  targetMax: number,
  results: Combo[],
  start = 0,
  sum = 0,
  subset: Item[] = []
) {
  if (sum > targetMax) return;
  if (subset.length === k) {
    results.push({ sum, items: [...subset] });
    return;
  }
  for (let i = start; i < list.length; i++) {
    subset.push(list[i]);
    getCombosWithSubset(list, k, targetMax, results, i + 1, sum + list[i].val, subset);
    subset.pop();
    if (results.length >= TOP_B) return;
  }
}

function streamA(
  list: Item[],
  k: number,
  targetMax: number,
  callback: (sum: number, items: Item[]) => void,
  start = 0,
  sum = 0,
  subset: Item[] = []
) {
  if (sum > targetMax) return;
  if (subset.length === k) {
    callback(sum, [...subset]);
    return;
  }
  for (let i = start; i < list.length; i++) {
    subset.push(list[i]);
    streamA(list, k, targetMax, callback, i + 1, sum + list[i].val, subset);
    subset.pop();
  }
}

// --- Hàm tìm 1 tổ hợp tốt nhất với độ dài k CỐ ĐỊNH ---
function findOneBestCombo(currentList: Item[], k: number, targetMax: number, targetMin: number): Combo | null {
  const N = currentList.length;
  // Nếu số lượng phần tử còn lại ít hơn k thì không thể ghép
  if (N < k) return null;

  if (k === 1) {
    // Chỉ chọn 1 số gần max nhất trong khoảng min-max
    let best: Item | null = null;
    for (const item of currentList) {
      if (item.val >= targetMin && item.val <= targetMax) {
        if (!best || item.val > best.val) best = item;
      }
    }
    if (best) return { sum: best.val, items: [best] };
    return null;
  }

  // Xử lý chia đôi MITM (Meet-in-the-middle)
  const K1 = Math.floor(k / 2);
  const K2 = k - K1;

  const A = currentList.slice(0, Math.ceil(N / 2));
  const B = currentList.slice(Math.ceil(N / 2));

  // 1. Tạo Combos B
  const combosB: Combo[] = [];
  getCombosWithSubset(B, K2, targetMax, combosB);
  combosB.sort((a, b) => a.sum - b.sum);

  let bestSum = -1;
  let bestItems: Item[] = [];
  let found = false;

  // 2. Stream A và ghép
  streamA(A, K1, targetMax, (sumA, itemsA) => {
    const needMaxB = targetMax - sumA;
    if (needMaxB < 0) return;

    // Binary Search
    let low = 0,
      high = combosB.length - 1,
      idx = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (combosB[mid].sum <= needMaxB) {
        idx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (idx !== -1) {
      const currentTotal = sumA + combosB[idx].sum;

      // Logic chọn cái tốt nhất:
      // 1. Phải nằm trong khoảng sai số (>= targetMin)
      // 2. Phải lớn hơn bestSum hiện tại (càng gần targetMax càng tốt)
      if (currentTotal >= targetMin && currentTotal > bestSum) {
        bestSum = currentTotal;
        bestItems = [...itemsA, ...combosB[idx].items];
        found = true;
      }
    }
  });

  if (found) {
    return { sum: bestSum, items: bestItems };
  }
  return null;
}

export const findOptimalSum = async (req: Request, res: Response) => {
  const { moneyList, minTarget, maxTarget, count, limit = 5 } = req.body;
  let MAX_ERROR_AMOUNT = 200000;

  console.log(moneyList, minTarget, maxTarget, count);

  if (!Array.isArray(moneyList) || !maxTarget || !count) {
    return res.status(400).json({ success: false, message: "Thiếu tham số." });
  }

  // Count bây giờ đóng vai trò là maxCount
  const maxCount = count;

  if (maxCount > K_MAX_SAFE) {
    return res.status(400).json({ success: false, message: `Count quá lớn (max=${K_MAX_SAFE}).` });
  }

  const targetMax = maxTarget;

  if (minTarget && minTarget !== 0) {
    MAX_ERROR_AMOUNT = maxTarget - minTarget;
  }

  const targetMin = targetMax - MAX_ERROR_AMOUNT;

  // 1. Chuẩn bị dữ liệu
  let availableItems: Item[] = moneyList
    .map((v: any, index: number) => ({ id: index, val: +v }))
    .filter((x) => !isNaN(x.val) && x.val > 0 && x.val <= targetMax);

  availableItems.sort((a, b) => b.val - a.val);

  const finalResults: Combo[] = [];

  // Mục đích: Ưu tiên tìm các tổ hợp đủ số lượng trước.
  for (let currentK = maxCount; currentK >= 1; currentK--) {
    // Nếu đã tìm đủ số lượng limit yêu cầu thì dừng toàn bộ
    if (finalResults.length >= limit) break;

    // Nếu danh sách số còn lại ít hơn currentK thì bỏ qua vòng này (vì không đủ ghép)
    if (availableItems.length < currentK) continue;

    // Vòng lặp tìm kiếm (Greedy) cho currentK hiện tại
    while (finalResults.length < limit) {
      const bestCombo = findOneBestCombo(availableItems, currentK, targetMax, targetMin);

      if (bestCombo) {
        // Tìm thấy -> Lưu lại
        finalResults.push(bestCombo);

        // Xoá các phần tử đã dùng
        const usedIds = new Set(bestCombo.items.map((item) => item.id));
        availableItems = availableItems.filter((item) => !usedIds.has(item.id));
      } else {
        // Không tìm thấy thêm tổ hợp nào với độ dài K này nữa -> Break để giảm K xuống
        break;
      }
    }
  }

  if (finalResults.length > 0) {
    return res.status(200).json({
      success: true,
      message: `Tìm được ${finalResults.length} tổ hợp.`,
      results: finalResults.map((r) => ({
        sum: r.sum,
        count: r.items.length, // Trả thêm field này để client biết tổ hợp này có bao nhiêu số
        subset: r.items.map((i) => i.val),
        indices: r.items.map((i) => i.id),
      })),
    });
  }

  return res.status(200).json({
    success: false,
    message: "Không tìm được tổ hợp nào phù hợp.",
    results: [],
  });
};
