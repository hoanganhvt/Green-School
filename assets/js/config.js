/* =========================================================================
   CẤU HÌNH CHUNG
   -------------------------------------------------------------------------
   1. Chế độ DEMO (mặc định): để FIREBASE_CONFIG = null. Dữ liệu lưu trong
      localStorage của trình duyệt, có sẵn dữ liệu mẫu để thử.
   2. Chế độ FIREBASE: dán cấu hình Web App lấy từ Firebase Console
      (Project settings → Your apps → SDK setup and configuration → Config)
      vào FIREBASE_CONFIG bên dưới. Nhớ có trường databaseURL.
      Hoặc dán cấu hình trong Trang quản trị → Cài đặt → Kết nối Firebase.
   ========================================================================= */
window.GS = window.GS || {};

GS.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAb2JRA1H3J5Rd38nYQ9aJN_IMjltx-Mes',
  authDomain: 'smarttrashbin-98428.firebaseapp.com',
  projectId: 'smarttrashbin-98428',
  databaseURL: 'https://smarttrashbin-98428-default-rtdb.asia-southeast1.firebasedatabase.app',
  storageBucket: 'smarttrashbin-98428.firebasestorage.app',
  messagingSenderId: '265760169937',
  appId: '1:265760169937:web:6d8449286dfc2c8158caf0'
};

/* Local Firebase is opt-in and never uses credentials saved in the browser. */
GS.USE_EMULATORS = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  && new URLSearchParams(location.search).get('firebase') === 'emulator';
GS.EMULATORS = { host: '127.0.0.1', authPort: 9099, databasePort: 9000 };
GS.EMULATOR_CONFIG = {
  apiKey: 'demo-green-school-key',
  authDomain: 'demo-green-school.firebaseapp.com',
  projectId: 'demo-green-school',
  databaseURL: 'https://demo-green-school-default-rtdb.firebaseio.com'
};
/* Ví dụ:
GS.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "green-school-xxxx.firebaseapp.com",
  databaseURL: "https://green-school-xxxx-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "green-school-xxxx",
  storageBucket: "green-school-xxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
*/

/* Tên miền giả dùng để tạo email nội bộ cho Firebase Auth
   (học sinh KHÔNG cần email; hệ thống tự ghép username + tên miền này). */
GS.AUTH_EMAIL_DOMAIN = 'greenschool.app';

GS.FIREBASE_SDK_VERSION = '10.12.2';

/* Giá trị mặc định — admin có thể đổi tất cả trong Trang quản trị → Cài đặt */
GS.DEFAULTS = {
  appName: 'Green School',
  slogan: 'Bỏ rác đúng chỗ, lớp mình lên top',
  schoolName: 'Trường THPT Xanh',
  seasonName: 'Mùa thi đua 2026–2027',
  sessionMinutes: 3,      // thời gian giữ phiên sau khi quét QR (phút)
  cooldownSeconds: 3,     // khoảng cách tối thiểu giữa 2 lượt của cùng 1 học sinh
  codePrefix: '',         // tiền tố mã học sinh, ví dụ "GS"
  baseUrl: '',            // để trống = tự lấy địa chỉ trang hiện tại
  rules: {
    plastic: { label: 'Nhựa', points: 2, enabled: true, color: '#2F8AD8', order: 1 },
    metal:   { label: 'Kim loại', points: 3, enabled: true, color: '#E8902C', order: 2 }
  }
};
