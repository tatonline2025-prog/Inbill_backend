import { Request, Response } from "express";

// --- Hằng số cấu hình ---
const K_MAX = 9; // Số lượng số hạng tối đa cho phép
const MAX_RESULTS_LIMIT = 10; // Số lượng tổ hợp tối đa cần tìm
const TARGET_SLACK = 10000; // Khoảng lỗi mặc định (10k)
const MAX_EXECUTION_TIME_MS = 60000;

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

// Khai báo ngoài hàm để dễ dàng tái sử dụng/reset
let currentBestCombo: Combo | null = null;

// Hàm so sánh độ tốt của 2 Combo: Ưu tiên Count lớn hơn, sau đó Sum gần Max hơn
function isBetterCombo(newCombo: Combo, targetMax: number): boolean {
  const current = currentBestCombo;
  if (!current) return true;

  // 1. Ưu tiên Count (số lượng số hạng) lớn hơn
  if (newCombo.count > current.count) return true;
  if (newCombo.count < current.count) return false;

  // 2. Nếu Count bằng nhau, ưu tiên Sum gần targetMax hơn
  return newCombo.sum > current.sum;
}

/**
 * Hàm Backtracking/DFS để tìm tổ hợp TỐT NHẤT TẠM THỜI từ danh sách hiện tại.
 */
function findOneOptimalComboDFS(
  list: Item[],
  kMax: number,
  targetMin: number,
  targetMax: number,
  deadline: number,
  start = 0,
  currentSum = 0,
  currentSubset: Item[] = []
) {
  if (Date.now() > deadline) {
    throw new Error("TIMEOUT"); // Ném lỗi để thoát ngay lập tức khỏi đệ quy
  }

  const currentCount = currentSubset.length;

  // --- Cắt tỉa 1: Vượt quá K tối đa ---
  if (currentCount > kMax) return;

  // --- Cắt tỉa 2: Vượt quá Tổng tối đa ---
  if (currentSum > targetMax) return;

  // --- Điều kiện Dừng & Lưu kết quả (Chỉ lưu 1 tổ hợp tốt nhất) ---
  if (currentCount > 0 && currentSum >= targetMin && currentSum <= targetMax) {
    const newCombo: Combo = { sum: currentSum, items: [...currentSubset], count: currentCount };

    // So sánh và cập nhật tổ hợp tốt nhất
    if (isBetterCombo(newCombo, targetMax)) {
      currentBestCombo = newCombo;
    }
  }

  // Cắt tỉa 3: Nếu đã chọn kMax số rồi thì không cần tìm tiếp
  let maxPossibleSum = currentSum;
  for (let j = start; j < list.length; j++) {
    maxPossibleSum += list[j].val;
  }

  if (maxPossibleSum < targetMin) {
    return;
  }

  // --- Lặp đệ quy ---
  for (let i = start; i < list.length; i++) {
    const item = list[i];

    // Cắt tỉa 4: Nếu tổng hiện tại + (kMax - currentCount) số nhỏ nhất còn lại
    // trong danh sách còn lại mà vẫn không đủ targetMin, thì không cần tìm tiếp. (Phức tạp, tạm bỏ qua)

    currentSubset.push(item);
    findOneOptimalComboDFS(list, kMax, targetMin, targetMax, deadline, i + 1, currentSum + item.val, currentSubset);
    currentSubset.pop(); // Backtrack

    // Tối ưu hóa: Nếu đã tìm được tổ hợp tốt nhất với sum = targetMax, có thể dừng sớm.
    if (currentBestCombo && currentBestCombo.sum === targetMax && currentBestCombo.count === kMax) return;
  }
}

// --- Hàm chính xử lý yêu cầu ---
export const findOptimalSum = async (req: Request, res: Response) => {
  try {
    const { moneyList, minTarget, maxTarget, count, limit = MAX_RESULTS_LIMIT } = req.body;

    if (!Array.isArray(moneyList) || !maxTarget || !count) {
      return res.status(400).json({ success: false, message: "Thiếu tham số (moneyList, maxTarget, count)." });
    }

    const startTime = Date.now();
    const deadline = startTime + MAX_EXECUTION_TIME_MS;

    const maxCount = Math.min(+count, K_MAX);
    const targetMax = +maxTarget;

    let targetMin = +minTarget || 0;
    if (targetMin < 0) targetMin = 0;

    // Chuẩn bị dữ liệu
    let availableItems: Item[] = moneyList
      .map((item: any, index: number) => {
        // Trường hợp 1: Item là object từ Frontend gửi lên (có moneyVal và originalIndex)
        if (typeof item === "object" && item !== null && "moneyVal" in item) {
          return {
            id: item.originalIndex, // QUAN TRỌNG: Dùng originalIndex để sau này map về đúng MKH
            mkh: item.mkh, // QUAN TRỌNG: Dùng originalIndex để sau này map về đúng MKH
            val: +item.moneyVal,
          };
        }

        // Trường hợp 2: Item chỉ là số bình thường (fallback cho code cũ)
        return {
          id: index,
          mkh: "undefined",
          val: +item,
        };
      })
      // 3. Lọc dữ liệu rác
      .filter((x) => !isNaN(x.val) && x.val > 0 && x.val <= targetMax)
      // 4. Sắp xếp giảm dần để cắt tỉa nhanh hơn
      .sort((a, b) => b.val - a.val);
    const finalResults: Combo[] = [];

    // Vòng lặp Tìm kiếm Lặp tham lam (Greedy Iterative Search)
    // Lặp cho đến khi tìm đủ 'limit' tổ hợp hoặc không tìm thấy tổ hợp nào nữa
    for (let i = 0; i < limit; i++) {
      // Reset và chạy tìm kiếm DFS để tìm tổ hợp TỐT NHẤT từ danh sách CÒN LẠI
      currentBestCombo = null;
      // iterationCount = 0;
      findOneOptimalComboDFS(availableItems, maxCount, targetMin, targetMax, deadline);

      const bestCombo = currentBestCombo as Combo | null;

      if (bestCombo) {
        // Tìm thấy -> Lưu lại
        finalResults.push(bestCombo);

        // Xóa các phần tử đã dùng khỏi danh sách CÒN LẠI
        const usedIds = new Set(bestCombo.items.map((item) => item.id));
        availableItems = availableItems.filter((item) => !usedIds.has(item.id));
      } else {
        // Không tìm thấy thêm tổ hợp nào phù hợp từ danh sách còn lại
        break;
      }
    }

    // 3. Phản hồi
    if (finalResults.length > 0) {
      return res.status(200).json({
        success: true,
        message: `Tìm được ${finalResults.length} tổ hợp độc lập.`,
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
    if (error.message === "TIMEOUT") {
      console.warn("Thuật toán đã bị dừng do quá thời gian cho phép.");
      return res.status(408).json({
        // 408 Request Timeout
        success: false,
        message: `Hệ thống đã dừng tìm kiếm vì quá thời gian xử lý (${
          MAX_EXECUTION_TIME_MS / 1000
        }s). Vui lòng thử lại với số lượng ít hơn.`,
      });
    }

    console.error("Lỗi trong quá trình tìm kiếm:", error);
    return res.status(500).json({ success: false, message: "Lỗi nội bộ máy chủ." });
  }
};
