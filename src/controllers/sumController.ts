import { Request, Response } from "express";

// --- Cấu hình thuật toán ---
const K_MAX_DEFAULT = 9; // Số lượng số hạng tối đa (nếu user không truyền)
const MAX_RESULTS_LIMIT = 10; // Số lượng tổ hợp cần tìm
const MAX_SEARCH_ITERATIONS = 200000; // Số lần thử ngẫu nhiên cho mỗi lần tìm 1 tổ hợp (Tăng lên nếu muốn chính xác hơn)
const MAX_TIME_PER_SEARCH_MS = 2000; // Thời gian tối đa (ms) cho phép tìm kiếm 1 tổ hợp

interface Item {
  id: number;
  mkh: string;
  val: number;
}

interface Combo {
  sum: number;
  items: Item[];
  count: number;
}

// Hàm so sánh độ tốt của 2 Combo
function isBetterCombo(newCombo: Combo, currentCombo: Combo | null): boolean {
  if (!currentCombo) return true;

  // 1. Ưu tiên số lượng phần tử (Count) nhiều hơn (theo logic cũ của bạn)
  if (newCombo.count > currentCombo.count) return true;
  if (newCombo.count < currentCombo.count) return false;

  // 2. Nếu Count bằng nhau, ưu tiên Sum LỚN HƠN (gần maxTarget hơn)
  return newCombo.sum > currentCombo.sum;
}

/**
 * Thuật toán Heuristic Random Search
 * Thay vì duyệt cây đệ quy (chậm), thử ngẫu nhiên hàng nghìn lần cực nhanh.
 */
function findBestComboHeuristic(items: Item[], maxCount: number, targetMin: number, targetMax: number): Combo | null {
  let bestCombo: Combo | null = null;
  const listLength = items.length;
  const startTime = Date.now();

  // Lặp lại việc chọn ngẫu nhiên nhiều lần
  for (let iter = 0; iter < MAX_SEARCH_ITERATIONS; iter++) {
    // Kiểm tra Timeout cho mỗi lần tìm kiếm
    if (iter % 1000 === 0 && Date.now() - startTime > MAX_TIME_PER_SEARCH_MS) {
      break;
    }

    let currentSum = 0;
    const currentItems: Item[] = [];

    // Tạo danh sách chỉ mục ngẫu nhiên để duyệt (Fisher-Yates Shuffle thu nhỏ)
    // Để tối ưu tốc độ, ta không shuffle cả mảng items gốc, mà chỉ random index
    const indices = Array.from({ length: listLength }, (_, i) => i);

    // Xáo trộn nhẹ một phần hoặc chọn ngẫu nhiên
    // Ở đây dùng cách đơn giản: Duyệt ngẫu nhiên qua danh sách
    for (let i = listLength - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    // Thử xây dựng 1 tổ hợp từ danh sách đã xáo trộn
    for (const idx of indices) {
      const item = items[idx];

      // Điều kiện 1: Không vượt quá số lượng cho phép
      if (currentItems.length >= maxCount) break;

      // Điều kiện 2: Không vượt quá tổng cho phép
      if (currentSum + item.val <= targetMax) {
        currentSum += item.val;
        currentItems.push(item);
      }
    }

    // Kiểm tra kết quả của lần thử này
    if (currentSum >= targetMin && currentSum <= targetMax) {
      const candidate: Combo = {
        sum: currentSum,
        items: currentItems,
        count: currentItems.length,
      };

      if (isBetterCombo(candidate, bestCombo)) {
        bestCombo = candidate;

        // Tối ưu cực đại: Nếu tìm được tổ hợp hoàn hảo (đúng bằng targetMax và đủ số lượng) -> Dừng ngay
        if (bestCombo.sum === targetMax && bestCombo.count === maxCount) {
          return bestCombo;
        }
      }
    }
  }

  return bestCombo;
}

export const findOptimalSum = async (req: Request, res: Response) => {
  try {
    const { moneyList, minTarget, maxTarget, count, limit = MAX_RESULTS_LIMIT } = req.body;

    // --- Validate đầu vào ---
    if (!Array.isArray(moneyList) || !maxTarget || !count) {
      return res.status(400).json({ success: false, message: "Thiếu tham số (moneyList, maxTarget, count)." });
    }

    const maxCount = Math.min(+count, K_MAX_DEFAULT);
    const targetMax = +maxTarget;
    let targetMin = +minTarget || 0;
    if (targetMin < 0) targetMin = 0;

    // --- Chuẩn bị dữ liệu (Giữ nguyên logic map của bạn) ---
    let availableItems: Item[] = moneyList
      .map((item: any, index: number) => {
        if (typeof item === "object" && item !== null && "moneyVal" in item) {
          return {
            id: item.originalIndex,
            mkh: item.mkh,
            val: +item.moneyVal,
          };
        }
        return {
          id: index,
          mkh: "undefined",
          val: +item,
        };
      })
      .filter((x) => !isNaN(x.val) && x.val > 0 && x.val <= targetMax);

    // Sắp xếp lại GIẢM DẦN để thuật toán tham lam (Greedy) chạy tốt hơn
    availableItems.sort((a, b) => b.val - a.val);

    const finalResults: Combo[] = [];
    const loopLimit = Math.min(limit, 50); // Giới hạn an toàn tối đa 50 kết quả

    // --- Vòng lặp tìm kiếm từng tổ hợp ---
    for (let i = 0; i < loopLimit; i++) {
      // Nếu hết hàng thì dừng
      if (availableItems.length === 0) break;

      // Gọi hàm tìm kiếm Heuristic
      const bestCombo = findBestComboHeuristic(availableItems, maxCount, targetMin, targetMax);

      if (bestCombo) {
        finalResults.push(bestCombo);

        // Loại bỏ các phần tử đã dùng để tìm tổ hợp tiếp theo
        const usedIds = new Set(bestCombo.items.map((item) => item.id));
        availableItems = availableItems.filter((item) => !usedIds.has(item.id));
      } else {
        // Nếu thuật toán random chạy 50.000 lần mà không ra -> coi như không còn tổ hợp khả thi
        break;
      }
    }

    // --- Phản hồi ---
    if (finalResults.length > 0) {
      return res.status(200).json({
        success: true,
        message: `Tìm được ${finalResults.length} tổ hợp.`,
        results: finalResults.map((r) => ({
          sum: r.sum,
          count: r.count,
          subset: r.items.map((i) => i.val),
          indices: r.items.map((i) => i.id),
          invoicenumbers: r.items.map((i) => i.mkh),
        })),
      });
    }

    return res.status(200).json({
      success: false,
      message: "Không tìm được tổ hợp nào phù hợp.",
      results: [],
    });
  } catch (error: any) {
    console.error("Lỗi server:", error);
    return res.status(500).json({ success: false, message: "Lỗi nội bộ máy chủ." });
  }
};
