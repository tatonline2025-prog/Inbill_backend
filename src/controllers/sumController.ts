import { Request, Response } from "express";

const MAX_ERROR_AMOUNT = 200000;
const K_MAX_SAFE = 9;

// Giới hạn để tránh lưu quá nhiều subset -> OOM
const TOP_B = 50000;

interface Combo {
  sum: number;
  subset: number[];
}

// Tạo combinations có subset
function getCombosWithSubset(
  list: number[],
  k: number,
  targetMax: number,
  results: Combo[],
  start = 0,
  sum = 0,
  subset: number[] = []
) {
  if (sum > targetMax) return;

  if (subset.length === k) {
    results.push({ sum, subset: [...subset] });
    return;
  }

  for (let i = start; i < list.length; i++) {
    subset.push(list[i]);
    getCombosWithSubset(list, k, targetMax, results, i + 1, sum + list[i], subset);
    subset.pop();

    // Anti‑OOM: dừng khi đủ TOP_B
    if (results.length >= TOP_B) return;
  }
}

// Streaming A (A không lưu subset để tiết kiệm RAM)
function streamA(
  list: number[],
  k: number,
  targetMax: number,
  callback: (sum: number, subset: number[]) => void,
  start = 0,
  sum = 0,
  subset: number[] = []
) {
  if (sum > targetMax) return;

  if (subset.length === k) {
    callback(sum, [...subset]);
    return;
  }

  for (let i = start; i < list.length; i++) {
    subset.push(list[i]);
    streamA(list, k, targetMax, callback, i + 1, sum + list[i], subset);
    subset.pop();
  }
}

export const findOptimalSum = async (req: Request, res: Response) => {
  const { moneyList, targetAmount, count } = req.body;

  if (!Array.isArray(moneyList) || !targetAmount || !count) {
    return res.status(400).json({ success: false, message: "Thiếu tham số." });
  }

  const k = count;
  if (k > K_MAX_SAFE) {
    return res.status(400).json({
      success: false,
      message: `Count quá lớn (max=${K_MAX_SAFE}).`,
    });
  }

  const targetMax = targetAmount;
  const targetMin = targetMax - MAX_ERROR_AMOUNT;

  const numbers = moneyList.map((v: any) => +v).filter((x) => !isNaN(x) && x > 0 && x <= targetMax);

  if (numbers.length < k) {
    return res.status(400).json({ success: false, message: "Không đủ số hợp lệ." });
  }

  // Chia MITM
  const N = numbers.length;
  const K1 = Math.floor(k / 2);
  const K2 = k - K1;

  const A = numbers.slice(0, Math.ceil(N / 2));
  const B = numbers.slice(Math.ceil(N / 2));

  // -------------------------------------
  // 1) Tạo combinations B (TOP_B)
  // -------------------------------------
  const combosB: Combo[] = [];
  getCombosWithSubset(B, K2, targetMax, combosB);

  // Sắp xếp để binary search
  combosB.sort((a, b) => a.sum - b.sum);

  // -------------------------------------
  // 2) Stream combos A
  // -------------------------------------
  let bestSum = -1;
  let bestSubset: number[] = [];

  streamA(A, K1, targetMax, (sumA, subsetA) => {
    const needMaxB = targetMax - sumA;
    if (needMaxB < 0) return;

    // binary search trong combosB
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
      const finalSum = sumA + combosB[idx].sum;

      if (finalSum > bestSum) {
        bestSum = finalSum;
        bestSubset = [...subsetA, ...combosB[idx].subset];
      }
    }
  });

  if (bestSum >= targetMin) {
    return res.status(200).json({
      success: true,
      message: `Tìm được tổng tối ưu ${bestSum}`,
      bestSum,
      bestSubset,
    });
  }

  if (bestSum > 0) {
    return res.status(200).json({
      success: false,
      message: `Không tìm được tổng trong khoảng sai số. Gần nhất: ${bestSum}`,
      bestSum,
      bestSubset,
    });
  }

  return res.status(200).json({
    success: false,
    message: "Không tìm được tổ hợp nào.",
    bestSum: 0,
    bestSubset: [],
  });
};
