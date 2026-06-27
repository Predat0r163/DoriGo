class Format {
  static money(value) {
    return `${new Intl.NumberFormat("ru-RU").format(value)} сум`;
  }

  static dateTime(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date).replace(",", "");
  }

  static expiryInput(value) {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}$/.test(text)) return text;
    const monthYear = text.match(/^(\d{1,2})[./-](\d{4})$/);
    if (monthYear) return `${monthYear[2]}-${monthYear[1].padStart(2, "0")}`;
    const date = text.match(/^(\d{4})-(\d{2})-\d{2}$/);
    return date ? `${date[1]}-${date[2]}` : "";
  }

  static expiryLabel(value) {
    const normalized = this.expiryInput(value);
    return normalized ? `${normalized.slice(5, 7)}.${normalized.slice(0, 4)}` : String(value || "Не указан");
  }

  static paragraphs(value, fallback = "") {
    const text = this.cleanText(value, fallback);
    if (!text) return "";
    return text
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${this.escape(paragraph).replace(/\n/g, "<br />")}</p>`)
      .join("");
  }

  static cleanText(value, fallback = "") {
    const text = String(value ?? "").trim();
    if (!text || /^(?:n\/?a|na|null|undefined|нет данных)$/i.test(text)) {
      return String(fallback || "").trim();
    }
    return text;
  }

  static display(value, fallback = "Не указано") {
    return this.cleanText(value, fallback);
  }

  static fileSize(bytes) {
    const size = Math.max(0, Number(bytes) || 0);
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
    if (size >= 1024) return `${Math.round(size / 1024)} КБ`;
    return `${size} Б`;
  }

  static escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}

class MapMath {
  static tileSize = 256;

  static clampLatitude(latitude) {
    return Math.min(85.05112878, Math.max(-85.05112878, Number(latitude) || 0));
  }

  static normalizeLongitude(longitude) {
    const value = Number(longitude) || 0;
    return ((value + 540) % 360) - 180;
  }

  static worldSize(zoom) {
    return this.tileSize * (2 ** Math.round(Number(zoom) || 15));
  }

  static longitudeToX(longitude, zoom) {
    return ((this.normalizeLongitude(longitude) + 180) / 360) * this.worldSize(zoom);
  }

  static latitudeToY(latitude, zoom) {
    const clamped = this.clampLatitude(latitude);
    const sin = Math.sin(clamped * Math.PI / 180);
    return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * this.worldSize(zoom);
  }

  static xToLongitude(x, zoom) {
    return this.normalizeLongitude((x / this.worldSize(zoom)) * 360 - 180);
  }

  static yToLatitude(y, zoom) {
    const n = Math.PI - (2 * Math.PI * y) / this.worldSize(zoom);
    return this.clampLatitude((180 / Math.PI) * Math.atan(Math.sinh(n)));
  }

  static project(point, zoom) {
    return {
      x: this.longitudeToX(point.longitude, zoom),
      y: this.latitudeToY(point.latitude, zoom),
    };
  }

  static unproject(x, y, zoom) {
    return {
      latitude: this.yToLatitude(y, zoom),
      longitude: this.xToLongitude(x, zoom),
    };
  }

  static pointFromCenter(point, center, zoom, width, height) {
    const centerPx = this.project(center, zoom);
    const pointPx = this.project(point, zoom);
    let deltaX = pointPx.x - centerPx.x;
    const world = this.worldSize(zoom);
    if (Math.abs(deltaX) > world / 2) deltaX += deltaX > 0 ? -world : world;
    return {
      x: width / 2 + deltaX,
      y: height / 2 + pointPx.y - centerPx.y,
    };
  }

  static coordinatesFromScreen(clientX, clientY, surface) {
    const rect = surface.getBoundingClientRect();
    const zoom = Number(surface.dataset.mapZoom || surface.dataset.zoom) || 15;
    const center = {
      latitude: Number(surface.dataset.mapLatitude || surface.dataset.latitude),
      longitude: Number(surface.dataset.mapLongitude || surface.dataset.longitude),
    };
    const centerPx = this.project(center, zoom);
    return this.unproject(
      centerPx.x + clientX - rect.left - rect.width / 2,
      centerPx.y + clientY - rect.top - rect.height / 2,
      zoom,
    );
  }

  static moveCenterByPixels(center, dx, dy, zoom) {
    const centerPx = this.project(center, zoom);
    return this.unproject(centerPx.x - dx, centerPx.y - dy, zoom);
  }
}

class Product {
  constructor(data) {
    Object.assign(this, data);
  }

  get priceLabel() {
    return Number(this.price) > 0 ? `от ${Format.money(this.price)}` : "Нет предложений";
  }

  get availabilityLabel() {
    return Number(this.pharmacies) > 0 ? `В наличии в ${this.pharmacies} аптеках` : "Аптеки ещё не подключили товар";
  }
}

class Pharmacy {
  constructor(data) {
    Object.assign(this, data);
  }
}

class Order {
  constructor(data) {
    Object.assign(this, data);
  }
}

class AccountService {
  constructor() {
    this.usersKey = "dorigo-users-v1";
    this.sessionKey = "dorigo-session-v1";
    this.workspaceKey = "dorigo-workspace-pharmacies-v1";
    this.users = this.read(this.usersKey, []);
    this.session = this.read(this.sessionKey, null);
    this.workspace = this.read(this.workspaceKey, null) || this.createWorkspace();
    this.saveWorkspace();
  }

  read(key, fallback) {
    try {
      const value = JSON.parse(window.localStorage.getItem(key) || "null");
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  write(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  normalizeContact(value) {
    return String(value || "").trim().toLowerCase().replace(/[\s()-]/g, "");
  }

  async hashPassword(password) {
    const data = new TextEncoder().encode(String(password || ""));
    const digest = await window.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  createWorkspace() {
    const pharmacy = this.createPharmacy({
      name: "Аптека №1",
      address: "Ташкент, Мирзо-Улугбекский район, ул. Шахрисабз, 23",
      phone: "+998 71 207-07-07",
      email: "apteka1@dorigo.uz",
      manager: "Александр Александров",
    });
    return { id: "workspace", organization: "DoriGo Partner", isNetwork: false, selectedPharmacyId: pharmacy.id, pharmacies: [pharmacy] };
  }

  createPharmacy(data = {}) {
    const id = data.id || `ph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const defaultHours = {};
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].forEach((day, index) => {
      defaultHours[day] = { enabled: index < 6, open: index < 5 ? "08:00" : "09:00", close: index < 5 ? "22:00" : "20:00" };
    });
    return {
      id,
      name: data.name || "Новая аптека",
      branchCode: data.branchCode || "",
      address: data.address || "",
      city: data.city || "Ташкент",
      district: data.district || "Мирзо-Улугбекский район",
      phone: data.phone || "",
      email: data.email || "",
      manager: data.manager || "",
      description: data.description || "",
      latitude: Number(data.latitude) || 41.3111,
      longitude: Number(data.longitude) || 69.2797,
      logoData: data.logoData || "",
      bank: {
        iban: data.bank?.iban || "",
        name: data.bank?.name || "",
        tin: data.bank?.tin || "",
        mfo: data.bank?.mfo || "",
        recipient: data.bank?.recipient || "",
      },
      delivery: {
        enabled: data.delivery?.enabled ?? true,
        pickup: data.delivery?.pickup ?? true,
        minOrder: Number(data.delivery?.minOrder) || 20000,
        assemblyMinutes: Number(data.delivery?.assemblyMinutes) || 30,
        radius: Number(data.delivery?.radius) || 8,
        fee: Number(data.delivery?.fee) || 0,
      },
      payments: {
        cash: data.payments?.cash ?? true,
        click: data.payments?.click ?? true,
        card: data.payments?.card ?? true,
        payme: data.payments?.payme ?? true,
      },
      hours: data.hours || defaultHours,
      employees: Array.isArray(data.employees) ? data.employees : [],
      documents: Array.isArray(data.documents) ? data.documents : [],
      notifications: {
        orders: data.notifications?.orders ?? true,
        lowStock: data.notifications?.lowStock ?? true,
        system: data.notifications?.system ?? true,
        reviews: data.notifications?.reviews ?? true,
        marketing: data.notifications?.marketing ?? false,
      },
      inventory: Array.isArray(data.inventory) ? data.inventory : [],
      orders: Array.isArray(data.orders) ? data.orders : [],
      orderAutomation: {
        autoConfirm: data.orderAutomation?.autoConfirm ?? false,
        limit: Number(data.orderAutomation?.limit) || 50000,
      },
      supportMessages: Array.isArray(data.supportMessages) ? data.supportMessages : [],
      reviewResponses: data.reviewResponses && typeof data.reviewResponses === "object" ? data.reviewResponses : {},
      syncEvents: Array.isArray(data.syncEvents) ? data.syncEvents : [],
      createdAt: data.createdAt || new Date().toISOString(),
    };
  }

  saveUsers() {
    this.write(this.usersKey, this.users);
  }

  saveSession() {
    this.write(this.sessionKey, this.session);
  }

  saveWorkspace() {
    this.write(this.workspaceKey, this.workspace);
  }

  currentUser() {
    if (!this.session?.userId) return null;
    const user = this.users.find((item) => item.id === this.session.userId) || null;
    if (user) this.ensureUserCollections(user);
    return user;
  }

  ensureUserCollections(user) {
    if (!user || typeof user !== "object") return user;
    if (user.type === "patient") {
      if (!Array.isArray(user.orders)) user.orders = [];
      if (!Array.isArray(user.favoriteProductIds)) user.favoriteProductIds = [];
      if (!Array.isArray(user.notifications)) user.notifications = [];
    }
    return user;
  }

  addNotificationToUser(user, data = {}) {
    if (!user || user.type !== "patient") return false;
    this.ensureUserCollections(user);
    const now = new Date().toISOString();
    const notification = {
      id: data.id || `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      key: data.key || "",
      type: data.type || "system",
      title: String(data.title || "Уведомление DoriGo"),
      text: String(data.text || ""),
      orderId: data.orderId || "",
      href: data.href || (data.orderId ? "#order" : "#account"),
      icon: data.icon || "bell",
      tone: data.tone || "blue",
      read: Boolean(data.read),
      createdAt: data.createdAt || now,
    };
    const duplicateIndex = notification.key
      ? user.notifications.findIndex((item) => item.key === notification.key)
      : -1;
    if (duplicateIndex >= 0) {
      user.notifications.splice(duplicateIndex, 1, {
        ...user.notifications[duplicateIndex],
        ...notification,
        id: user.notifications[duplicateIndex].id,
        read: false,
        createdAt: notification.createdAt,
      });
    } else {
      user.notifications.unshift(notification);
    }
    user.notifications = user.notifications
      .slice()
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
      .slice(0, 80);
    return true;
  }

  patientNotifications() {
    const user = this.currentUser();
    if (!user || user.type !== "patient") return [];
    this.ensureUserCollections(user);
    return user.notifications
      .slice()
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }

  markPatientNotificationRead(id = "") {
    const user = this.currentUser();
    if (!user || user.type !== "patient") return { ok: false, message: "Войдите как пациент." };
    this.ensureUserCollections(user);
    const targetId = String(id || "");
    let changed = 0;
    user.notifications.forEach((notification) => {
      if (!targetId || notification.id === targetId) {
        if (!notification.read) changed += 1;
        notification.read = true;
      }
    });
    this.saveUsers();
    return { ok: true, changed, message: targetId ? "Уведомление отмечено прочитанным." : "Все уведомления прочитаны." };
  }

  notifyOrderCreated(user, order) {
    return this.addNotificationToUser(user, {
      key: `order-created-${order.id}`,
      type: "order",
      title: `Заказ #${order.id} создан`,
      text: `${order.pharmacyName || "Аптека"} получила заказ на ${Format.money(order.amount || 0)}.`,
      orderId: order.id,
      href: "#order",
      icon: "shopping-bag",
      tone: "green",
    });
  }

  notifyOrderStatus(user, order, previousStatus = "") {
    const status = String(order.status || "");
    if (!status || status === previousStatus) return false;
    const titleByStatus = {
      "Подтвержден": "Аптека подтвердила заказ",
      "Собирается": "Заказ начали собирать",
      "Собран": "Заказ собран",
      "Передан курьеру": "Заказ передан курьеру",
      "В пути": "Курьер уже в пути",
      "Доставлен": "Заказ доставлен",
      "Отменен": "Заказ отменен",
    };
    const toneByStatus = {
      "Доставлен": "green",
      "Отменен": "red",
      "В пути": "blue",
      "Передан курьеру": "blue",
    };
    return this.addNotificationToUser(user, {
      key: `order-status-${order.id}-${status}`,
      type: "order",
      title: titleByStatus[status] || `Статус заказа: ${status}`,
      text: `Заказ #${order.id}: ${previousStatus ? `${previousStatus} → ` : ""}${status}.`,
      orderId: order.id,
      href: "#order",
      icon: status === "Доставлен" ? "check-circle" : status === "Отменен" ? "circle-x" : "truck",
      tone: toneByStatus[status] || "blue",
    });
  }

  notifyReviewResponse(user, order) {
    if (!order.reviewResponse?.response) return false;
    return this.addNotificationToUser(user, {
      key: `review-response-${order.id}-${order.reviewResponse.updatedAt || ""}`,
      type: "support",
      title: "Аптека ответила на отзыв",
      text: String(order.reviewResponse.response || "").slice(0, 140),
      orderId: order.id,
      href: "#order",
      icon: "message-circle",
      tone: "green",
    });
  }

  notifyOrderMessage(user, order, message = {}) {
    if (!message.id || message.author !== "pharmacy") return false;
    return this.addNotificationToUser(user, {
      key: `order-message-${order.id}-${message.id}`,
      type: "chat",
      title: "Новое сообщение от аптеки",
      text: String(message.text || "").slice(0, 140),
      orderId: order.id,
      href: "#order",
      icon: "message-circle",
      tone: "blue",
    });
  }

  patientFavorites() {
    const user = this.currentUser();
    if (!user || user.type !== "patient") return [];
    if (!Array.isArray(user.favoriteProductIds)) user.favoriteProductIds = [];
    return user.favoriteProductIds;
  }

  isFavorite(productId) {
    return this.patientFavorites().includes(String(productId || ""));
  }

  toggleFavorite(productId) {
    const user = this.currentUser();
    if (!user || user.type !== "patient") {
      return { ok: false, message: "Войдите как пациент, чтобы сохранять избранное." };
    }
    const id = String(productId || "").trim();
    if (!id) return { ok: false, message: "Товар не найден." };
    if (!Array.isArray(user.favoriteProductIds)) user.favoriteProductIds = [];
    const index = user.favoriteProductIds.indexOf(id);
    const added = index < 0;
    if (added) user.favoriteProductIds.unshift(id);
    else user.favoriteProductIds.splice(index, 1);
    user.favoriteProductIds = [...new Set(user.favoriteProductIds)].slice(0, 80);
    this.saveUsers();
    return { ok: true, added, message: added ? "Товар добавлен в избранное." : "Товар удален из избранного." };
  }

  async registerPatient(data) {
    return this.register({
      type: "patient",
      name: data.name,
      contact: data.contact,
      password: data.password,
      address: data.address || "",
    });
  }

  async registerPharmacy(data) {
    const pharmacy = this.createPharmacy({
      name: data.pharmacyName,
      address: data.address,
      phone: data.contact,
      email: String(data.contact || "").includes("@") ? data.contact : "",
      manager: data.name,
    });
    return this.register({
      type: "pharmacy",
      name: data.name,
      contact: data.contact,
      password: data.password,
      organization: data.organization || data.pharmacyName,
      isNetwork: Boolean(data.isNetwork),
      selectedPharmacyId: pharmacy.id,
      pharmacies: [pharmacy],
    });
  }

  async register(data) {
    const contact = String(data.contact || "").trim();
    const normalized = this.normalizeContact(contact);
    if (!data.name?.trim() || !normalized || String(data.password || "").length < 6) {
      return { ok: false, message: "Заполните обязательные поля. Пароль должен содержать минимум 6 символов." };
    }
    if (this.users.some((user) => user.type === data.type && this.normalizeContact(user.contact) === normalized)) {
      return { ok: false, message: "Аккаунт с таким телефоном или email уже существует для данного типа пользователя." };
    }
    const user = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: data.type,
      name: data.name.trim(),
      contact,
      passwordHash: await this.hashPassword(data.password),
      address: data.address || "",
      latitude: Number(data.latitude) || null,
      longitude: Number(data.longitude) || null,
      orders: Array.isArray(data.orders) ? data.orders : [],
      favoriteProductIds: Array.isArray(data.favoriteProductIds) ? data.favoriteProductIds : [],
      notifications: Array.isArray(data.notifications) ? data.notifications : [],
      organization: data.organization || "",
      isNetwork: Boolean(data.isNetwork),
      selectedPharmacyId: data.selectedPharmacyId || null,
      pharmacies: data.pharmacies || [],
      createdAt: new Date().toISOString(),
    };
    this.users.push(user);
    this.session = { userId: user.id, signedInAt: new Date().toISOString() };
    this.saveUsers();
    this.saveSession();
    return { ok: true, user };
  }

  async login(contact, password, type = "patient") {
    const normalized = this.normalizeContact(contact);
    const passwordHash = await this.hashPassword(password);
    const user = this.users.find((item) => 
      item.type === type && 
      this.normalizeContact(item.contact) === normalized && 
      item.passwordHash === passwordHash
    );
    if (!user) return { ok: false, message: "Неверный телефон, email или пароль." };
    this.session = { userId: user.id, signedInAt: new Date().toISOString() };
    this.saveSession();
    return { ok: true, user };
  }

  logout() {
    this.session = null;
    this.saveSession();
  }

  updateCurrentUser(data) {
    const user = this.currentUser();
    if (!user) return { ok: false, message: "Сначала войдите в аккаунт." };
    const name = String(data.name || "").trim();
    const contact = String(data.contact || "").trim();
    const normalized = this.normalizeContact(contact);
    if (!name || !normalized) {
      return { ok: false, message: "Укажите имя и телефон или email." };
    }
    const duplicate = this.users.some((item) => item.id !== user.id && this.normalizeContact(item.contact) === normalized);
    if (duplicate) {
      return { ok: false, message: "Этот телефон или email уже используется другим аккаунтом." };
    }
    user.name = name;
    user.contact = contact;
    user.address = String(data.address || "").trim();
    if (Number.isFinite(Number(data.latitude))) user.latitude = Number(data.latitude);
    if (Number.isFinite(Number(data.longitude))) user.longitude = Number(data.longitude);
    user.updatedAt = new Date().toISOString();
    this.saveUsers();
    return { ok: true, user, message: "Данные профиля сохранены." };
  }

  async changePassword(currentPassword, newPassword) {
    const user = this.currentUser();
    if (!user) return { ok: false, message: "Сначала войдите в аккаунт." };
    if (String(newPassword || "").length < 6) {
      return { ok: false, message: "Новый пароль должен содержать минимум 6 символов." };
    }
    const currentHash = await this.hashPassword(currentPassword);
    if (currentHash !== user.passwordHash) {
      return { ok: false, message: "Текущий пароль указан неверно." };
    }
    user.passwordHash = await this.hashPassword(newPassword);
    user.updatedAt = new Date().toISOString();
    this.saveUsers();
    return { ok: true, message: "Пароль успешно изменён." };
  }

  pharmacyAccount() {
    const user = this.currentUser();
    return user?.type === "pharmacy" ? user : this.workspace;
  }

  pharmacies() {
    return this.pharmacyAccount().pharmacies || [];
  }

  marketplacePharmacies() {
    const userRecords = this.users
      .filter((user) => user.type === "pharmacy")
      .flatMap((user) => (user.pharmacies || []).map((pharmacy) => ({
        ownerId: user.id,
        organization: user.organization || pharmacy.name,
        pharmacy,
      })));
    const workspaceRecords = (this.workspace?.pharmacies || []).map((pharmacy) => ({
      ownerId: "workspace",
      organization: this.workspace.organization || pharmacy.name,
      pharmacy,
    }));
    return [...userRecords, ...workspaceRecords];
  }

  findMarketplacePharmacy(pharmacyId) {
    return this.marketplacePharmacies().find((record) => record.pharmacy.id === pharmacyId) || null;
  }

  saveMarketplacePharmacy(pharmacyId, patch = {}) {
    const record = this.findMarketplacePharmacy(pharmacyId);
    if (!record) return null;
    Object.assign(record.pharmacy, patch);
    if (record.ownerId === "workspace") this.saveWorkspace();
    else this.saveUsers();
    return record.pharmacy;
  }

  addPatientOrder(order) {
    const user = this.currentUser();
    if (!user || user.type !== "patient") return false;
    if (!Array.isArray(user.orders)) user.orders = [];
    user.orders.unshift(order);
    this.notifyOrderCreated(user, order);
    this.saveUsers();
    return true;
  }

  syncOrderToPatients(order) {
    this.users.forEach((user) => {
      if (user.type !== "patient" || !Array.isArray(user.orders)) return;
      const index = user.orders.findIndex((item) => item.id === order.id);
      if (index >= 0) {
        this.ensureUserCollections(user);
        const previousOrder = user.orders[index];
        const previousStatus = previousOrder.status || "";
        const previousResponseAt = previousOrder.reviewResponse?.updatedAt || "";
        const previousMessages = Array.isArray(previousOrder.messages) ? previousOrder.messages : [];
        const previousLastMessageId = previousMessages[previousMessages.length - 1]?.id || "";
        const nextOrder = { ...previousOrder, ...order };
        user.orders.splice(index, 1, nextOrder);
        if (nextOrder.status && nextOrder.status !== previousStatus) {
          this.notifyOrderStatus(user, nextOrder, previousStatus);
        }
        if (nextOrder.reviewResponse?.updatedAt && nextOrder.reviewResponse.updatedAt !== previousResponseAt) {
          this.notifyReviewResponse(user, nextOrder);
        }
        const nextMessages = Array.isArray(nextOrder.messages) ? nextOrder.messages : [];
        const latestMessage = nextMessages[nextMessages.length - 1] || null;
        if (latestMessage?.id && latestMessage.id !== previousLastMessageId) {
          this.notifyOrderMessage(user, nextOrder, latestMessage);
        }
      }
    });
    this.saveUsers();
  }

  activePharmacy() {
    const account = this.pharmacyAccount();
    return account.pharmacies.find((pharmacy) => pharmacy.id === account.selectedPharmacyId) || account.pharmacies[0] || null;
  }

  persistPharmacyAccount(account) {
    if (account.id === "workspace") {
      this.workspace = account;
      this.saveWorkspace();
      return;
    }
    this.saveUsers();
  }

  selectPharmacy(id) {
    const account = this.pharmacyAccount();
    if (!account.pharmacies.some((pharmacy) => pharmacy.id === id)) return false;
    account.selectedPharmacyId = id;
    this.persistPharmacyAccount(account);
    return true;
  }

  addPharmacy(data) {
    const account = this.pharmacyAccount();
    const pharmacy = this.createPharmacy(data);
    account.pharmacies.push(pharmacy);
    account.selectedPharmacyId = pharmacy.id;
    account.isNetwork = account.pharmacies.length > 1;
    this.persistPharmacyAccount(account);
    return pharmacy;
  }

  updateActivePharmacy(patch) {
    const account = this.pharmacyAccount();
    const pharmacy = this.activePharmacy();
    if (!pharmacy) return null;
    Object.entries(patch).forEach(([key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        pharmacy[key] = { ...(pharmacy[key] || {}), ...value };
      } else {
        pharmacy[key] = value;
      }
    });
    this.persistPharmacyAccount(account);
    return pharmacy;
  }

  addEmployee(employee) {
    const pharmacy = this.activePharmacy();
    if (!pharmacy) return null;
    const record = { id: `employee-${Date.now()}`, ...employee };
    pharmacy.employees.push(record);
    this.persistPharmacyAccount(this.pharmacyAccount());
    return record;
  }

  deleteEmployee(id) {
    const pharmacy = this.activePharmacy();
    if (!pharmacy) return false;
    pharmacy.employees = pharmacy.employees.filter((employee) => employee.id !== id);
    this.persistPharmacyAccount(this.pharmacyAccount());
    return true;
  }

  addDocument(file) {
    const pharmacy = this.activePharmacy();
    if (!pharmacy) return null;
    const document = {
      id: `document-${Date.now()}`,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      status: "Загружен",
      uploadedAt: new Date().toISOString(),
    };
    pharmacy.documents.push(document);
    this.persistPharmacyAccount(this.pharmacyAccount());
    return document;
  }

  deleteDocument(id) {
    const pharmacy = this.activePharmacy();
    if (!pharmacy) return false;
    pharmacy.documents = pharmacy.documents.filter((document) => document.id !== id);
    this.persistPharmacyAccount(this.pharmacyAccount());
    return true;
  }
}

class DoriGoStore {
  constructor(accountService) {
    this.accounts = accountService;
    this.products = [
      new Product({
        id: "ibuprofen-200",
        name: "Ибупрофен",
        subtitle: "200 мг, таблетки N20",
        category: "Обезболивающие",
        ingredient: "Ибупрофен 200 мг",
        price: 6000,
        pharmacies: 164,
        stock: 142,
        reserve: 12,
        color: "blue",
        status: "Без рецепта",
        mnn: "Ибупрофен",
      }),
      new Product({
        id: "nurofen-400",
        name: "Нурофен",
        subtitle: "400 мг, таблетки N20",
        category: "Обезболивающие",
        ingredient: "Ибупрофен",
        price: 17500,
        pharmacies: 128,
        stock: 5,
        reserve: 3,
        color: "red",
        status: "Без рецепта",
        mnn: "Ибупрофен",
      }),
      new Product({
        id: "magnesium-b6",
        name: "Магний B6",
        subtitle: "таблетки N50",
        category: "Витамины",
        ingredient: "Магний + Пиридоксин",
        price: 24000,
        pharmacies: 97,
        stock: 2,
        reserve: 0,
        color: "blue",
        status: "Мало",
        mnn: "Магний + Пиридоксин",
      }),
      new Product({
        id: "omega-3",
        name: "Омега-3",
        subtitle: "1000 мг, капсулы N60",
        category: "БАДы",
        ingredient: "Омега-3 кислоты",
        price: 38000,
        pharmacies: 112,
        stock: 23,
        reserve: 5,
        color: "orange",
        status: "Без рецепта",
        mnn: "Омега-3 кислоты",
      }),
      new Product({
        id: "nazivin",
        name: "Називин",
        subtitle: "капли назальные 0,05% 10 мл",
        category: "Противоотечные",
        ingredient: "Оксиметазолин",
        price: 16000,
        pharmacies: 86,
        stock: 3,
        reserve: 1,
        color: "green",
        status: "Мало",
        mnn: "Оксиметазолин",
      }),
      new Product({
        id: "ascorbinka",
        name: "Аскорбинка",
        subtitle: "100 мг, таблетки N10",
        category: "Витамины",
        ingredient: "Аскорбиновая кислота",
        price: 3000,
        pharmacies: 203,
        stock: 0,
        reserve: 0,
        color: "orange",
        status: "Нет в наличии",
        mnn: "Аскорбиновая кислота",
      }),
      new Product({
        id: "ibuklin",
        name: "Ибуклин",
        subtitle: "400 мг + 325 мг, таблетки N10",
        category: "Жаропонижающие",
        ingredient: "Ибупрофен + Парацетамол",
        price: 19000,
        pharmacies: 118,
        stock: 19,
        reserve: 2,
        color: "orange",
        status: "Без рецепта",
        mnn: "Ибупрофен + Парацетамол",
      }),
      new Product({
        id: "ketorolac",
        name: "Кеторолак",
        subtitle: "10 мг, таблетки N20",
        category: "Обезболивающие",
        ingredient: "Кеторолак",
        price: 8200,
        pharmacies: 71,
        stock: 0,
        reserve: 0,
        color: "green",
        status: "Нет в наличии",
        mnn: "Кеторолак",
      }),
      new Product({
        id: "teraflu",
        name: "Терафлю",
        subtitle: "порошок N10",
        category: "Простуда и грипп",
        ingredient: "Парацетамол",
        price: 7300,
        pharmacies: 91,
        stock: 19,
        reserve: 2,
        color: "blue",
        status: "Без рецепта",
        mnn: "Парацетамол",
      }),
      new Product({
        id: "amoxiclav",
        name: "Амоксиклав",
        subtitle: "875/125 мг N14",
        category: "Антибиотики",
        ingredient: "Амоксициллин",
        price: 19800,
        pharmacies: 42,
        stock: 0,
        reserve: 0,
        color: "green",
        status: "Нет в наличии",
        mnn: "Амоксициллин",
      }),
      new Product({
        id: "ibuprofen-forte",
        name: "Ибупрофен форте",
        subtitle: "400 мг, таблетки N20",
        category: "Обезболивающие",
        ingredient: "Ибупрофен",
        price: 11000,
        pharmacies: 78,
        stock: 34,
        reserve: 4,
        color: "purple",
        status: "Без рецепта",
        mnn: "Ибупрофен",
      }),
      new Product({
        id: "children-ibuprofen",
        name: "Детский ибупрофен",
        subtitle: "100 мг/5 мл, суспензия 100 мл",
        category: "Детские препараты",
        ingredient: "Ибупрофен",
        price: 13000,
        pharmacies: 94,
        stock: 20,
        reserve: 3,
        color: "red",
        status: "Без рецепта",
        mnn: "Ибупрофен",
      }),
    ];

    const externalCatalog = Array.isArray(window.DORIGO_UZ_CATALOG?.products)
      ? window.DORIGO_UZ_CATALOG.products
      : [];
    const sportsCatalog = Array.isArray(window.DORIGO_SPORTS_CATALOG?.products)
      ? window.DORIGO_SPORTS_CATALOG.products
      : [];
    const combinedCatalog = [...externalCatalog, ...sportsCatalog];
    const officialData = window.DORIGO_UZ_OFFICIAL_DATA?.products || {};
    const productImageData = window.DORIGO_UZ_PRODUCT_IMAGES?.products || {};
    this.catalogProducts = combinedCatalog.length
      ? combinedCatalog.map((product, index) => this.normalizeProduct({
        ...product,
        ...(officialData[product.id] || {}),
        ...(productImageData[product.id] || {}),
      }, index))
      : this.createCatalog(this.products);
    this.catalogContentKey = "dorigo-catalog-content-v1";
    this.catalogContent = this.loadCatalogContent();
    this.applyCatalogContent();
    this.inventoryKey = "dorigo-pharmacy-inventory-v3";
    this.inventoryMigrationKey = "dorigo-pharmacy-inventory-owner-v1";
    this.pharmacyInventory = [];
    this.categoryKey = "dorigo-pharmacy-categories-v1";
    this.orderKey = "dorigo-pharmacy-orders-v2";
    this.orders = [];
    this.customerLocationKey = "dorigo-customer-location-v1";
    this.customerLocation = this.loadCustomerLocation();
    this.courierProfileKey = "dorigo-courier-profile-v1";
    this.courierProfile = this.loadCourierProfile();
    this.selectedProductId = null;
    this.selectedOfferId = null;
    this.highlightedOfferId = "";
    this.selectedPatientOrderId = null;
    this.selectedCourierOrderId = null;
    this.selectedSupportReviewId = null;
    this.lastCourierError = "";
    this.checkoutMode = false;
    this.checkoutQuantity = 1;
    this.offerSort = "best";
    this.repairMarketplaceData();
    this.syncActivePharmacyData();
    this.categories = this.loadCategories();
    this.refreshMarketplaceProducts();
    this.selectedOrderId = this.orders[0]?.id || null;
    this.seedMarketplaceData();
  }

  seedMarketplaceData() {
    if (this.accounts.users.some(u => u.type === 'pharmacy')) return;

    const demoPharmacies = [
      { name: "Grand Pharm", address: "ул. Амира Темура, 15", lat: 41.3111, lon: 69.2797 },
      { name: "Best Medicine", address: "Чиланзар, кв-л 2, 14", lat: 41.2833, lon: 69.2123 },
      { name: "Аптека 24/7", address: "Юнусабад, 19-й квартал", lat: 41.3645, lon: 69.2871 },
      { name: "Dori-Darmon", address: "ул. Махтумкули, 2", lat: 41.3033, lon: 69.3255 },
      { name: "Arzon Apteka", address: "Сергели-8, д. 12", lat: 41.2211, lon: 69.2433 },
      { name: "OxyMed", address: "ул. Ойбек, 38", lat: 41.2955, lon: 69.2711 },
      { name: "Ташкент-Фарм", address: "ТТЗ-2, массив 1", lat: 41.3511, lon: 69.3522 },
      { name: "Здоровье", address: "ул. Шота Руставели, 45", lat: 41.2811, lon: 69.2533 },
      { name: "Авиценна", address: "Каракамыш 2/4", lat: 41.3533, lon: 69.2211 },
      { name: "Центральная", address: "Сквер Амира Темура", lat: 41.3122, lon: 69.2811 }
    ];

    // Создаем аптеки
    const createdPharmacies = [];
    demoPharmacies.forEach(async (data, idx) => {
      const contact = `+99890000000${idx}`;
      const reg = await this.accounts.registerPharmacy({
        name: "Фармацевт " + data.name,
        pharmacyName: data.name,
        address: "Ташкент, " + data.address,
        contact: contact,
        password: "password123",
        organization: "OOO " + data.name,
        latitude: data.lat,
        longitude: data.lon
      });
      if (reg.ok) createdPharmacies.push(reg.user.pharmacies[0]);
    });

    // Запускаем распределение
    const distribute = () => {
      const pharmacies = this.accounts.users
        .filter(u => u.type === 'pharmacy')
        .flatMap(u => u.pharmacies);

      if (pharmacies.length === 0) return;

      let changed = false;
      this.catalogProducts.forEach(product => {
        // Проверяем, есть ли уже предложения для этого товара
        const existingOffers = pharmacies.filter(ph => 
          ph.inventory && ph.inventory.some(inv => inv.catalogId === product.id)
        );

        // Если предложений меньше 5, добавляем в случайные аптеки
        if (existingOffers.length < 5) {
          const needed = 5 - existingOffers.length;
          const availablePharmacies = pharmacies.filter(ph => 
            !ph.inventory || !ph.inventory.some(inv => inv.catalogId === product.id)
          );
          
          const selected = availablePharmacies
            .sort(() => 0.5 - Math.random())
            .slice(0, needed);

          selected.forEach(pharmacy => {
            if (!pharmacy.inventory) pharmacy.inventory = [];
            pharmacy.inventory.push({
              id: `inv-${pharmacy.id}-${product.id}`,
              catalogId: product.id,
              name: product.name,
              price: Math.round((15000 + Math.random() * 35000) / 500) * 500,
              stock: Math.floor(Math.random() * 100) + 20,
              reserve: 0,
              published: true,
              updatedAt: new Date().toISOString()
            });
            changed = true;
          });
        }
      });

      if (changed) {
        this.accounts.saveUsers();
        this.refreshMarketplaceProducts();
      }
    };

    // Выполняем проверку и наполнение
    setTimeout(distribute, 300);
  }

  loadCatalogContent() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(this.catalogContentKey) || "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch {
      return {};
    }
  }

  applyCatalogContent() {
    this.catalogProducts = this.catalogProducts.map((product) => {
      const override = this.catalogContent[product.id] || {};
      const overrideImages = Array.isArray(override.images) ? override.images : [];
      const hasValidOverrideImages = Ui.productImages({ images: overrideImages }).length > 0;
      return new Product({
        ...product,
        ...override,
        imageData: override.imageData || product.imageData || "",
        images: hasValidOverrideImages ? overrideImages : product.images,
      });
    });
  }

  repairMarketplaceData() {
    const pharmacyAccounts = [
      ...this.accounts.users.filter((user) => user.type === "pharmacy"),
      this.accounts.workspace,
    ].filter(Boolean);
    let changed = false;
    pharmacyAccounts.forEach((account) => {
      if (!Array.isArray(account.pharmacies)) account.pharmacies = [];
      account.pharmacies.forEach((pharmacy) => {
        if (this.repairPharmacyRecord(pharmacy)) changed = true;
      });
    });
    if (changed) {
      this.accounts.saveUsers();
      this.accounts.saveWorkspace();
    }
  }

  repairPharmacyRecord(pharmacy) {
    let changed = false;
    if (!Array.isArray(pharmacy.inventory)) {
      pharmacy.inventory = [];
      changed = true;
    }
    if (!Array.isArray(pharmacy.orders)) {
      pharmacy.orders = [];
      changed = true;
    }
    if (!Array.isArray(pharmacy.syncEvents)) {
      pharmacy.syncEvents = [];
      changed = true;
    }
    if (!Array.isArray(pharmacy.supportMessages)) {
      pharmacy.supportMessages = [];
      changed = true;
    }
    if (!pharmacy.reviewResponses || typeof pharmacy.reviewResponses !== "object" || Array.isArray(pharmacy.reviewResponses)) {
      pharmacy.reviewResponses = {};
      changed = true;
    }
    if (!pharmacy.orderAutomation || typeof pharmacy.orderAutomation !== "object" || Array.isArray(pharmacy.orderAutomation)) {
      pharmacy.orderAutomation = { autoConfirm: false, limit: 50000 };
      changed = true;
    } else {
      const repairedAutomation = {
        autoConfirm: pharmacy.orderAutomation.autoConfirm ?? false,
        limit: Number(pharmacy.orderAutomation.limit) || 50000,
      };
      if (JSON.stringify(repairedAutomation) !== JSON.stringify(pharmacy.orderAutomation)) {
        pharmacy.orderAutomation = repairedAutomation;
        changed = true;
      }
    }

    pharmacy.inventory = pharmacy.inventory.map((offer) => {
      const catalog = this.findCatalogProduct(offer);
      if (!catalog) return offer;
      const stock = Math.max(0, Number(offer.stock) || 0);
      const reserve = Math.max(0, Number(offer.reserve) || 0);
      const repaired = {
        ...offer,
        catalogId: catalog.id,
        name: catalog.name,
        subtitle: catalog.subtitle || offer.subtitle || "",
        category: catalog.category || offer.category || "Прочее",
        mnn: catalog.mnn || catalog.ingredient || offer.mnn || "",
        ingredient: catalog.ingredient || catalog.mnn || offer.ingredient || "",
        dosage: catalog.dosage || offer.dosage || "",
        form: catalog.form || offer.form || "",
        packageSize: catalog.packageSize || offer.packageSize || "",
        manufacturer: catalog.manufacturer || offer.manufacturer || "",
        price: Math.max(0, Number(offer.price) || 0),
        purchasePrice: Math.max(0, Number(offer.purchasePrice) || 0),
        stock,
        reserve,
        available: Math.max(0, stock - reserve),
        rxRequired: Boolean(catalog.rxRequired),
        prescriptionStatus: catalog.prescriptionStatus || (catalog.rxRequired ? "По рецепту" : "Без рецепта"),
        prescription: catalog.prescriptionStatus || (catalog.rxRequired ? "По рецепту" : "Без рецепта"),
        images: Ui.productImages(catalog),
        imageData: catalog.imageData || offer.imageData || "",
        published: offer.published !== false,
        pharmacyId: pharmacy.id,
        updatedAt: offer.updatedAt || new Date().toISOString(),
      };
      if (JSON.stringify(repaired) !== JSON.stringify(offer)) changed = true;
      return repaired;
    });

    const offersById = new Map(pharmacy.inventory.map((offer) => [offer.id, offer]));
    pharmacy.orders = pharmacy.orders.map((order) => {
      const repaired = this.repairOrderRecord(order, pharmacy, offersById);
      if (repaired !== order) changed = true;
      return repaired;
    });
    return changed;
  }

  repairOrderRecord(order, pharmacy, offersById = new Map()) {
    const now = new Date();
    const createdAt = order.createdAt || now.toISOString();
    const items = Array.isArray(order.items) ? order.items.map((item) => {
      const offer = offersById.get(item.offerId) || offersById.get(item.productId);
      const catalog = this.productById(item.productId || offer?.catalogId || offer?.id);
      const itemImages = Ui.productImages(item);
      const fallbackImages = Ui.productImages(catalog || offer || {});
      return {
        ...item,
        productId: item.productId || offer?.catalogId || catalog?.id || "",
        offerId: item.offerId || offer?.id || "",
        name: item.name || catalog?.name || offer?.name || order.productName || "Товар",
        subtitle: item.subtitle || catalog?.subtitle || offer?.subtitle || "",
        category: item.category || catalog?.category || offer?.category || order.category || "Прочее",
        price: Math.max(0, Number(item.price) || Number(offer?.price) || 0),
        purchasePrice: Math.max(0, Number(item.purchasePrice) || Number(offer?.purchasePrice) || 0),
        quantity: Math.max(1, Number(item.quantity) || 1),
        imageData: item.imageData || catalog?.imageData || offer?.imageData || "",
        images: itemImages.length ? itemImages : fallbackImages,
      };
    }) : [];
    const deliveryType = order.type === "Самовывоз" ? "Самовывоз" : "Доставка";
    const deliveryFee = deliveryType === "Доставка" ? Math.max(0, Number(order.deliveryFee) || Number(pharmacy.delivery?.fee) || 0) : 0;
    const itemsAmount = items.reduce((sum, item) => sum + Number(item.price || 0) * (Number(item.quantity) || 1), 0);
    const clientPoint = {
      latitude: Number(order.clientLatitude) || Number(order.latitude) || Number(this.customerLocation.latitude) || Number(pharmacy.latitude),
      longitude: Number(order.clientLongitude) || Number(order.longitude) || Number(this.customerLocation.longitude) || Number(pharmacy.longitude),
    };
    const pharmacyPoint = {
      latitude: Number(pharmacy.latitude) || 41.3111,
      longitude: Number(pharmacy.longitude) || 69.2797,
    };
    const distance = deliveryType === "Доставка" ? this.distanceKm(clientPoint, pharmacyPoint) : null;
    const status = order.status || "Новый";
    const needsCourierData = ["Передан курьеру", "В пути", "Доставлен"].includes(status) && deliveryType === "Доставка";
    const repaired = {
      ...order,
      id: order.id || `DG-${String(Date.now()).slice(-6)}`,
      date: order.date || createdAt.slice(0, 10),
      time: order.time || now.toTimeString().slice(0, 5),
      createdAt,
      client: order.client || "Клиент",
      phone: order.phone || "",
      address: order.address || order.district || "",
      district: order.district || order.address || "Ташкент",
      clientLatitude: clientPoint.latitude,
      clientLongitude: clientPoint.longitude,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      pharmacyAddress: pharmacy.address,
      pharmacyLatitude: pharmacyPoint.latitude,
      pharmacyLongitude: pharmacyPoint.longitude,
      type: deliveryType,
      deliveryFee,
      status,
      payment: order.payment || "Наличные",
      items,
      itemCount: items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0) || Number(order.itemCount) || 1,
      amount: Math.max(0, Number(order.amount) || itemsAmount + deliveryFee),
      distance: distance ?? (Number(order.distance) || 0),
      duration: deliveryType === "Доставка" && distance !== null
        ? Math.round((Number(pharmacy.delivery?.assemblyMinutes) || 30) + Math.max(15, distance * 5))
        : Number(order.duration) || Number(pharmacy.delivery?.assemblyMinutes) || 30,
      confirmationCode: needsCourierData ? String(order.confirmationCode || Math.floor(1000 + Math.random() * 9000)) : order.confirmationCode,
      courierFee: needsCourierData ? this.courierFee({ ...order, distance: distance ?? order.distance }) : order.courierFee,
      updatedAt: order.updatedAt || createdAt,
      messages: Array.isArray(order.messages) ? order.messages : [],
      statusHistory: this.normalizeOrderHistory({ ...order, status }, createdAt),
    };
    return JSON.stringify(repaired) === JSON.stringify(order) ? order : repaired;
  }

  saveCatalogProductContent(productId, data) {
    const product = this.catalogProducts.find((item) => item.id === productId);
    if (!product) return { ok: false, message: "Карточка каталога не найдена." };
    if (data.sourceVerified && (!String(data.sourceName || "").trim() || !String(data.sourceUrl || "").trim())) {
      return { ok: false, message: "Для подтвержденной карточки укажите название и ссылку на официальный источник." };
    }
    const allowed = [
      "name",
      "mnn",
      "ingredient",
      "dosage",
      "form",
      "packageSize",
      "category",
      "fullTradeName",
      "dosageFormDetails",
      "pharmacotherapeuticGroup",
      "registrationDate",
      "registrationChangeDate",
      "sourceDocument",
      "description",
      "usage",
      "composition",
      "indications",
      "contraindications",
      "storageConditions",
      "manufacturer",
      "country",
      "registrationNumber",
      "atcCode",
      "rxRequired",
      "prescriptionStatus",
      "instructionUrl",
      "sourceName",
      "sourceUrl",
      "sourceUpdatedAt",
      "sourceVerified",
      "images",
      "imageData",
      "photoName",
    ];
    const patch = {};
    allowed.forEach((key) => {
      if (data[key] !== undefined) patch[key] = data[key];
    });
    patch.updatedAt = new Date().toISOString();
    this.catalogContent[productId] = { ...(this.catalogContent[productId] || {}), ...patch };
    try {
      window.localStorage.setItem(this.catalogContentKey, JSON.stringify(this.catalogContent));
    } catch {
      return { ok: false, message: "Не удалось сохранить карточку. Уменьшите количество или размер фотографий." };
    }
    Object.assign(product, patch);
    this.refreshMarketplaceProducts();
    return { ok: true, product, message: "Единая карточка препарата сохранена." };
  }

  loadPharmacyInventory() {
    const pharmacy = this.accounts.activePharmacy();
    return Array.isArray(pharmacy?.inventory) ? pharmacy.inventory.map((item) => new Product(item)) : [];
  }

  savePharmacyInventory() {
    const pharmacy = this.accounts.activePharmacy();
    if (!pharmacy) return;
    pharmacy.inventory = this.pharmacyInventory.map((item) => ({ ...item }));
    this.accounts.persistPharmacyAccount(this.accounts.pharmacyAccount());
    this.refreshMarketplaceProducts();
  }

  setOfferPublished(productId, published) {
    const product = this.pharmacyInventory.find((item) => item.id === productId || item.catalogId === productId);
    if (!product) return { ok: false, message: "Товар не найден в ассортименте аптеки." };
    product.published = Boolean(published);
    product.updatedAt = new Date().toISOString();
    this.savePharmacyInventory();
    this.recordSyncEvent(
      product.published ? `Товар опубликован: ${product.name}` : `Товар скрыт с витрины: ${product.name}`,
      "Успешно",
      product.published ? "Позиция снова доступна клиентам в сравнении аптек." : "Позиция не показывается клиентам, но доступна в кабинете аптеки.",
    );
    return {
      ok: true,
      product,
      message: product.published ? "Товар опубликован на витрине." : "Товар скрыт с клиентской витрины.",
    };
  }

  approveMarketplaceOffer(pharmacyId, offerId) {
    const record = this.accounts.findMarketplacePharmacy(pharmacyId);
    const product = (record?.pharmacy?.inventory || []).find((item) => item.id === offerId || item.catalogId === offerId);
    if (!record || !product) return { ok: false, message: "Предложение аптеки не найдено." };
    const stock = Math.max(0, Number(product.stock) || 0);
    const price = Math.max(0, Number(product.price) || 0);
    product.moderationStatus = "Активен";
    product.published = stock > 0 && price > 0;
    product.available = Math.max(0, stock - Number(product.reserve || 0));
    product.status = stock === 0 ? "Нет в наличии" : stock <= 7 ? "Мало" : product.rxRequired ? "Рецептурный" : "Без рецепта";
    product.updatedAt = new Date().toISOString();
    if (!Array.isArray(record.pharmacy.syncEvents)) record.pharmacy.syncEvents = [];
    record.pharmacy.syncEvents.unshift({
      id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: `Модерация товара: ${product.name}`,
      status: product.published ? "Успешно" : "На рассмотрении",
      details: product.published
        ? "Админ разрешил товар, предложение опубликовано на витрине клиента."
        : "Админ разрешил товар, но для публикации нужна цена и положительный остаток.",
      createdAt: product.updatedAt,
    });
    record.pharmacy.syncEvents = record.pharmacy.syncEvents.slice(0, 50);
    this.persistMarketplaceRecord(record);
    if (record.pharmacy.id === this.accounts.activePharmacy()?.id) this.syncActivePharmacyData();
    this.refreshMarketplaceProducts();
    return {
      ok: true,
      product,
      message: product.published
        ? "Товар разрешен и опубликован на клиентской витрине."
        : "Товар разрешен. Добавьте цену и остаток, чтобы он появился на витрине.",
    };
  }

  recordSyncEvent(title, status = "Успешно", details = "") {
    const pharmacy = this.accounts.activePharmacy();
    if (!pharmacy) return;
    if (!Array.isArray(pharmacy.syncEvents)) pharmacy.syncEvents = [];
    pharmacy.syncEvents.unshift({
      id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      status,
      details,
      createdAt: new Date().toISOString(),
    });
    pharmacy.syncEvents = pharmacy.syncEvents.slice(0, 50);
    this.accounts.persistPharmacyAccount(this.accounts.pharmacyAccount());
  }

  syncEvents() {
    const pharmacy = this.accounts.activePharmacy();
    const saved = Array.isArray(pharmacy?.syncEvents) ? pharmacy.syncEvents : [];
    if (saved.length) return saved;
    return this.pharmacyInventory
      .filter((product) => product.updatedAt)
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 8)
      .map((product) => ({
        id: `product-${product.id}`,
        title: `Обновлен товар: ${product.name}`,
        status: "Успешно",
        details: `${Format.money(product.price)} · остаток ${product.stock} шт.`,
        createdAt: product.updatedAt,
      }));
  }

  reviewResponses() {
    const pharmacy = this.accounts.activePharmacy();
    return pharmacy?.reviewResponses && typeof pharmacy.reviewResponses === "object" ? pharmacy.reviewResponses : {};
  }

  saveReviewResponse(orderId, response) {
    const pharmacy = this.accounts.activePharmacy();
    const text = String(response || "").trim();
    if (!pharmacy) return { ok: false, message: "Аптека не выбрана." };
    if (!orderId || !text) return { ok: false, message: "Напишите ответ клиенту." };
    if (!pharmacy.reviewResponses || typeof pharmacy.reviewResponses !== "object" || Array.isArray(pharmacy.reviewResponses)) {
      pharmacy.reviewResponses = {};
    }
    const savedResponse = {
      response: text,
      updatedAt: new Date().toISOString(),
    };
    pharmacy.reviewResponses[orderId] = savedResponse;

    const record = this.marketplaceOrderRecord(orderId);
    if (record?.order) {
      record.order.reviewResponse = savedResponse;
      this.addOrderHistory(record.order, {
        type: "support",
        icon: "message-circle",
        title: "Аптека ответила на отзыв",
        details: text.slice(0, 120),
        status: record.order.status,
        actor: pharmacy.name,
        createdAt: savedResponse.updatedAt,
      });
      this.persistMarketplaceRecord(record);
      this.accounts.syncOrderToPatients(record.order);
      this.syncActivePharmacyData();
    }

    this.accounts.persistPharmacyAccount(this.accounts.pharmacyAccount());
    this.recordSyncEvent(`Ответ клиенту по заказу #${orderId}`, "Успешно", text.slice(0, 120));
    return { ok: true, message: `Ответ по заказу #${orderId} сохранен и будет виден в карточке обращения.` };
  }

  supportMessages() {
    const pharmacy = this.accounts.activePharmacy();
    return Array.isArray(pharmacy?.supportMessages) ? pharmacy.supportMessages : [];
  }

  sendSupportMessage(message) {
    const pharmacy = this.accounts.activePharmacy();
    const text = String(message || "").trim();
    if (!pharmacy) return { ok: false, message: "Аптека не выбрана." };
    if (!text) return { ok: false, message: "Введите сообщение для поддержки." };
    if (!Array.isArray(pharmacy.supportMessages)) pharmacy.supportMessages = [];
    const now = new Date().toISOString();
    pharmacy.supportMessages.push({
      id: `msg-${Date.now()}`,
      author: "pharmacy",
      text,
      createdAt: now,
    });
    pharmacy.supportMessages.push({
      id: `msg-${Date.now()}-support`,
      author: "support",
      text: "Приняли сообщение. Мы проверим данные по аптеке и вернемся с ответом в этом чате.",
      createdAt: new Date(Date.now() + 1000).toISOString(),
    });
    pharmacy.supportMessages = pharmacy.supportMessages.slice(-40);
    this.accounts.persistPharmacyAccount(this.accounts.pharmacyAccount());
    this.recordSyncEvent("Сообщение в поддержку DoriGo", "Успешно", text.slice(0, 120));
    return { ok: true, message: "Сообщение отправлено и сохранено в чате поддержки." };
  }

  sendSupportAttachment(file = {}) {
    const pharmacy = this.accounts.activePharmacy();
    const name = String(file.name || "").trim();
    if (!pharmacy) return { ok: false, message: "Аптека не выбрана." };
    if (!name) return { ok: false, message: "Выберите файл для отправки." };
    if (!Array.isArray(pharmacy.supportMessages)) pharmacy.supportMessages = [];
    const now = new Date().toISOString();
    const attachment = {
      name,
      size: Math.max(0, Number(file.size) || 0),
      type: String(file.type || "Файл"),
    };
    pharmacy.supportMessages.push({
      id: `msg-${Date.now()}-attachment`,
      author: "pharmacy",
      text: "Вложение отправлено в поддержку.",
      attachment,
      createdAt: now,
    });
    pharmacy.supportMessages.push({
      id: `msg-${Date.now()}-attachment-support`,
      author: "support",
      text: `Получили файл «${name}». Проверим и вернемся с ответом в этом чате.`,
      createdAt: new Date(Date.now() + 1000).toISOString(),
    });
    pharmacy.supportMessages = pharmacy.supportMessages.slice(-40);
    this.accounts.persistPharmacyAccount(this.accounts.pharmacyAccount());
    this.recordSyncEvent("Вложение в поддержку DoriGo", "Успешно", `${name} · ${Format.fileSize(attachment.size)}`);
    return { ok: true, message: `Файл «${name}» добавлен в чат поддержки.` };
  }

  refreshInventorySync() {
    if (!this.pharmacyInventory.length) {
      return { ok: false, message: "В аптеке пока нет товаров для обновления." };
    }
    const now = new Date().toISOString();
    this.pharmacyInventory.forEach((product) => {
      product.reserve = Math.min(Math.max(0, Number(product.reserve) || 0), Math.max(0, Number(product.stock) || 0));
      product.available = Math.max(0, Number(product.stock) - Number(product.reserve || 0));
      product.status = Number(product.stock) === 0
        ? "Нет в наличии"
        : Number(product.stock) <= 7
          ? "Мало"
          : product.rxRequired
            ? "Рецептурный"
            : "Без рецепта";
      product.updatedAt = now;
    });
    this.savePharmacyInventory();
    this.recordSyncEvent(`Обновлено остатков: ${this.pharmacyInventory.length} позиций`, "Успешно", "Доступность пересчитана и опубликована в каталоге клиента.");
    return { ok: true, count: this.pharmacyInventory.length };
  }

  syncActivePharmacyData() {
    const pharmacy = this.accounts.activePharmacy();
    if (!pharmacy) {
      this.pharmacyInventory = [];
      this.orders = [];
      return;
    }

    if (!Array.isArray(pharmacy.inventory)) {
      let legacy = [];
      const migratedOwner = window.localStorage.getItem(this.inventoryMigrationKey);
      if (!migratedOwner) {
        try {
          legacy = JSON.parse(window.localStorage.getItem(this.inventoryKey) || "[]");
        } catch {
          legacy = [];
        }
        window.localStorage.setItem(this.inventoryMigrationKey, pharmacy.id);
      }
      pharmacy.inventory = Array.isArray(legacy) ? legacy : [];
    }
    if (!Array.isArray(pharmacy.orders)) pharmacy.orders = [];
    if (!Array.isArray(pharmacy.syncEvents)) pharmacy.syncEvents = [];
    pharmacy.inventory = pharmacy.inventory.map((item) => {
      const catalog = this.findCatalogProduct(item);
      if (!catalog) return null;
      return {
        ...item,
        catalogId: catalog.id,
        name: catalog.name,
        subtitle: catalog.subtitle || "",
        mnn: catalog.mnn || catalog.ingredient || "",
        ingredient: catalog.ingredient || catalog.mnn || "",
        dosage: catalog.dosage || "",
        form: catalog.form || "",
        packageSize: catalog.packageSize || "",
        manufacturer: catalog.manufacturer || "",
        category: catalog.category || "Прочее",
        rxRequired: Boolean(catalog.rxRequired),
        prescriptionStatus: catalog.prescriptionStatus || (catalog.rxRequired ? "По рецепту" : "Без рецепта"),
        prescription: catalog.prescriptionStatus || (catalog.rxRequired ? "По рецепту" : "Без рецепта"),
        imageData: catalog.imageData || "",
        photoName: catalog.photoName || "",
        images: Ui.productImages(catalog),
        moderationStatus: item.moderationStatus || "Активен",
        published: item.published !== false,
      };
    }).filter(Boolean);
    const now = Date.now();
    pharmacy.inventory.forEach((item) => {
      const promotionEnd = Date.parse(item.promotion?.endAt || "");
      if (item.promotion?.active && Number.isFinite(promotionEnd) && promotionEnd < now) {
        item.price = Number(item.basePrice) || Number(item.price) || 0;
        item.promotion = null;
        item.updatedAt = new Date().toISOString();
      }
    });
    this.pharmacyInventory = pharmacy.inventory.map((item) => new Product(item));
    this.orders = pharmacy.orders.map((item) => new Order(item));
    this.selectedOrderId = this.orders.some((order) => order.id === this.selectedOrderId)
      ? this.selectedOrderId
      : this.orders[0]?.id || null;
    this.accounts.persistPharmacyAccount(this.accounts.pharmacyAccount());
  }

  loadCategories() {
    let saved = [];
    try {
      saved = JSON.parse(window.localStorage.getItem(this.categoryKey) || "[]");
    } catch {
      saved = [];
    }
    const records = new Map((Array.isArray(saved) ? saved : []).map((item) => [item.name, item]));
    this.pharmacyInventory.forEach((product) => {
      const name = product.category || "Прочее";
      if (!records.has(name)) records.set(name, { name, online: true, prescription: "Без ограничений" });
    });
    return Array.from(records.values());
  }

  saveCategories() {
    try {
      window.localStorage.setItem(this.categoryKey, JSON.stringify(this.categories));
    } catch {
      // Keep current-session category changes when storage is unavailable.
    }
  }

  ensureCategory(name) {
    const value = String(name || "Прочее").trim() || "Прочее";
    if (!this.categories.some((category) => category.name === value)) {
      this.categories.push({ name: value, online: true, prescription: "Без ограничений" });
      this.saveCategories();
    }
  }

  addCategory(data) {
    const name = String(data.name || "").trim();
    if (!name) return { ok: false, message: "Введите название категории" };
    if (this.categories.some((category) => this.normalizeLookup(category.name) === this.normalizeLookup(name))) {
      return { ok: false, message: "Такая категория уже существует" };
    }
    this.categories.push({
      name,
      online: data.online !== false,
      prescription: String(data.prescription || "Без ограничений"),
    });
    this.saveCategories();
    return { ok: true };
  }

  toggleCategory(name) {
    const category = this.categories.find((item) => item.name === name);
    if (!category) return false;
    category.online = !category.online;
    this.saveCategories();
    return true;
  }

  deleteCategory(name) {
    const count = this.pharmacyInventory.filter((product) => product.category === name).length;
    if (count) return { ok: false, message: "Сначала переместите товары из этой категории" };
    this.categories = this.categories.filter((category) => category.name !== name);
    this.saveCategories();
    return { ok: true };
  }

  categoryStats() {
    const total = Math.max(1, this.pharmacyInventory.length);
    return this.categories.map((category) => ({
      ...category,
      count: this.pharmacyInventory.filter((product) => product.category === category.name).length,
      published: this.pharmacyInventory.filter((product) => product.category === category.name && product.published !== false).length,
      lowStock: this.pharmacyInventory.filter((product) => {
        const available = Math.max(0, Number(product.stock) - Number(product.reserve || 0));
        return product.category === category.name && available > 0 && available <= 7;
      }).length,
      share: Math.round((this.pharmacyInventory.filter((product) => product.category === category.name).length / total) * 100),
    }));
  }

  isCategoryOnline(name) {
    const category = this.categories.find((item) => item.name === name);
    return category ? category.online !== false : true;
  }

  loadOrders() {
    const pharmacy = this.accounts.activePharmacy();
    return Array.isArray(pharmacy?.orders) ? pharmacy.orders.map((order) => new Order(order)) : [];
  }

  saveOrders() {
    const pharmacy = this.accounts.activePharmacy();
    if (!pharmacy) return;
    pharmacy.orders = this.orders.map((order) => ({ ...order }));
    this.accounts.persistPharmacyAccount(this.accounts.pharmacyAccount());
    this.orders.forEach((order) => this.accounts.syncOrderToPatients(order));
  }

  normalizeOrderHistory(order, createdAt = new Date().toISOString()) {
    const existing = Array.isArray(order?.statusHistory) ? order.statusHistory.filter(Boolean) : [];
    if (existing.length) {
      return existing
        .map((entry, index) => ({
          id: entry.id || `hist-${order?.id || "order"}-${index}`,
          type: entry.type || "system",
          icon: entry.icon || "clock",
          title: String(entry.title || "Событие заказа"),
          details: String(entry.details || ""),
          status: entry.status || order?.status || "",
          actor: entry.actor || "",
          createdAt: entry.createdAt || createdAt,
        }))
        .slice(-80);
    }
    return [{
      id: `hist-${order?.id || Date.now()}-created`,
      type: "created",
      icon: "shopping-bag",
      title: "Заказ создан",
      details: `${order?.client || "Пациент"} оформил заказ в ${order?.pharmacyName || "аптеке"}.`,
      status: order?.status || "Новый",
      actor: order?.client || "Пациент",
      createdAt,
    }];
  }

  addOrderHistory(order, entry = {}) {
    if (!order) return null;
    if (!Array.isArray(order.statusHistory)) {
      order.statusHistory = this.normalizeOrderHistory(order, order.createdAt || new Date().toISOString());
    }
    const now = entry.createdAt || new Date().toISOString();
    const historyEntry = {
      id: entry.id || `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: entry.type || "system",
      icon: entry.icon || "clock",
      title: String(entry.title || "Событие заказа"),
      details: String(entry.details || ""),
      status: entry.status || order.status || "",
      actor: entry.actor || "",
      createdAt: now,
    };
    const duplicateKey = entry.key || "";
    if (duplicateKey && order.statusHistory.some((item) => item.key === duplicateKey)) return null;
    if (duplicateKey) historyEntry.key = duplicateKey;
    order.statusHistory.push(historyEntry);
    order.statusHistory = order.statusHistory
      .slice()
      .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0))
      .slice(-80);
    return historyEntry;
  }

  orderAutomationSettings() {
    const pharmacy = this.accounts.activePharmacy();
    return {
      autoConfirm: pharmacy?.orderAutomation?.autoConfirm ?? false,
      limit: Number(pharmacy?.orderAutomation?.limit) || 50000,
    };
  }

  saveOrderAutomation(data = {}) {
    const pharmacy = this.accounts.activePharmacy();
    if (!pharmacy) return { ok: false, message: "Аптека не выбрана." };
    const autoConfirm = Boolean(data.autoConfirm);
    const limit = Math.max(0, Number(data.limit) || 0);
    pharmacy.orderAutomation = { autoConfirm, limit };
    let confirmed = 0;
    if (autoConfirm) {
      const now = new Date().toISOString();
      this.orders.forEach((order) => {
        if (order.status !== "Новый" || Number(order.amount) > limit) return;
        const previousStatus = order.status;
        order.status = "Подтвержден";
        order.updatedAt = now;
        this.addOrderHistory(order, {
          key: `auto-confirm-${now}`,
          type: "status",
          icon: "check-circle",
          title: "Заказ автоподтвержден",
          details: `${previousStatus} → Подтвержден. Сумма попала в лимит ${Format.money(limit)}.`,
          status: "Подтвержден",
          actor: "DoriGo",
          createdAt: now,
        });
        confirmed += 1;
      });
    }
    this.saveOrders();
    this.recordSyncEvent(
      autoConfirm ? "Автоподтверждение заказов включено" : "Автоподтверждение заказов выключено",
      "Успешно",
      autoConfirm ? `Лимит: ${Format.money(limit)}. Подтверждено сейчас: ${confirmed}.` : "Новые заказы снова требуют ручного подтверждения.",
    );
    return {
      ok: true,
      confirmed,
      message: autoConfirm
        ? `Автоподтверждение сохранено. Сейчас подтверждено: ${confirmed}.`
        : "Автоподтверждение выключено.",
    };
  }

  nextOrderStatus(status) {
    const sequence = ["Новый", "Подтвержден", "Собирается", "Собран", "Передан курьеру", "В пути", "Доставлен"];
    const index = sequence.indexOf(status);
    return index >= 0 && index < sequence.length - 1 ? sequence[index + 1] : status;
  }

  orderActionLabel(status) {
    return {
      "Новый": "Подтвердить",
      "Подтвержден": "Начать сборку",
      "Собирается": "Собрать",
      "Собран": "Передать курьеру",
    }[status] || "";
  }

  advanceOrder(id) {
    const order = this.orders.find((item) => item.id === id);
    if (!order) return null;
    const previousStatus = order.status;
    if (order.status === "Собран" && order.type === "Доставка" && !order.courierName) {
      this.applyCourierAssignment(order);
    }
    const nextStatus = this.nextOrderStatus(order.status);
    const pharmacy = this.accounts.activePharmacy();
    if (pharmacy && !["Доставлен", "Отменен"].includes(nextStatus)) {
      order.pharmacyId = pharmacy.id;
      order.pharmacyName = pharmacy.name;
      order.pharmacyAddress = pharmacy.address;
      order.pharmacyLatitude = Number(pharmacy.latitude);
      order.pharmacyLongitude = Number(pharmacy.longitude);
      const distance = this.distanceKm(
        { latitude: order.clientLatitude, longitude: order.clientLongitude },
        { latitude: pharmacy.latitude, longitude: pharmacy.longitude },
      );
      if (order.type === "Доставка" && distance !== null) {
        order.distance = distance;
        order.duration = Math.round((Number(pharmacy.delivery?.assemblyMinutes) || 30) + Math.max(15, distance * 5));
      }
    }
    if (nextStatus === "Передан курьеру" && order.type === "Доставка") {
      this.applyCourierAssignment(order, order.courierName);
      this.selectedCourierOrderId = order.id;
    }
    if (nextStatus === "Собран") {
      (order.items || []).forEach((item) => {
        item.collected = true;
      });
    }
    if (nextStatus === "Доставлен" && order.status !== "Доставлен") {
      (order.items || []).forEach((item) => {
        const offer = this.pharmacyInventory.find((product) => product.id === item.offerId || product.catalogId === item.productId);
        if (!offer) return;
        const quantity = Number(item.quantity) || 1;
        offer.stock = Math.max(0, Number(offer.stock) - quantity);
        offer.reserve = Math.max(0, Number(offer.reserve) - quantity);
        offer.available = Math.max(0, offer.stock - offer.reserve);
      });
      this.savePharmacyInventory();
    }
    order.status = nextStatus;
    order.updatedAt = new Date().toISOString();
    if (previousStatus !== nextStatus) {
      this.addOrderHistory(order, {
        type: "status",
        icon: nextStatus === "Передан курьеру" ? "bike" : nextStatus === "Собран" ? "package-check" : "refresh-cw",
        title: `Статус изменен: ${nextStatus}`,
        details: `${previousStatus} → ${nextStatus}`,
        status: nextStatus,
        actor: "Аптека",
        createdAt: order.updatedAt,
      });
    }
    this.saveOrders();
    return order;
  }

  cancelOrder(id) {
    const order = this.orders.find((item) => item.id === id);
    if (!order || ["Доставлен", "Отменен"].includes(order.status)) return null;
    const previousStatus = order.status;
    (order.items || []).forEach((item) => {
      const offer = this.pharmacyInventory.find((product) => product.id === item.offerId || product.catalogId === item.productId);
      if (!offer) return;
      const quantity = Number(item.quantity) || 1;
      offer.reserve = Math.max(0, Number(offer.reserve) - quantity);
      offer.available = Math.max(0, Number(offer.stock) - offer.reserve);
    });
    this.savePharmacyInventory();
    order.status = "Отменен";
    order.updatedAt = new Date().toISOString();
    this.addOrderHistory(order, {
      type: "status",
      icon: "circle-x",
      title: "Заказ отменен",
      details: `${previousStatus} → Отменен`,
      status: "Отменен",
      actor: "Аптека",
      createdAt: order.updatedAt,
    });
    this.saveOrders();
    return order;
  }

  bulkAdvanceOrders(ids = []) {
    let updated = 0;
    ids.forEach((id) => {
      const order = this.orders.find((item) => item.id === id);
      if (!order || !this.orderActionLabel(order.status)) return;
      if (this.advanceOrder(id)) updated += 1;
    });
    return {
      ok: updated > 0,
      updated,
      message: updated
        ? `Обновлено заказов: ${updated}.`
        : "Нет выбранных заказов, которые можно перевести дальше.",
    };
  }

  bulkCancelOrders(ids = []) {
    let cancelled = 0;
    ids.forEach((id) => {
      if (this.cancelOrder(id)) cancelled += 1;
    });
    return {
      ok: cancelled > 0,
      cancelled,
      message: cancelled
        ? `Отменено заказов: ${cancelled}.`
        : "Нет выбранных заказов, которые можно отменить.",
    };
  }

  setOrderItemCollected(orderId, itemIndex, collected) {
    const order = this.orders.find((item) => item.id === orderId);
    if (!order || !Array.isArray(order.items) || !order.items[itemIndex]) {
      return { ok: false, message: "Позиция заказа не найдена." };
    }
    if (["Собран", "Передан курьеру", "В пути", "Доставлен", "Отменен"].includes(order.status)) {
      return { ok: false, message: "Чеклист уже закрыт для этого статуса заказа." };
    }
    order.items[itemIndex].collected = Boolean(collected);
    order.updatedAt = new Date().toISOString();
    this.addOrderHistory(order, {
      type: "checklist",
      icon: collected ? "check" : "rotate-ccw",
      title: "Сборка товара обновлена",
      details: `${order.items[itemIndex].name || "Позиция заказа"}: ${collected ? "собрано" : "отметка снята"}.`,
      status: order.status,
      actor: "Аптека",
      createdAt: order.updatedAt,
    });
    this.saveOrders();
    const done = order.items.filter((item) => item.collected).length;
    return { ok: true, order, message: `Собрано ${done} из ${order.items.length} позиций.` };
  }

  scanOrderItem(orderId, code) {
    const value = String(code || "").trim();
    if (!value) return { ok: false, message: "Введите или отсканируйте штрихкод." };
    const order = this.orders.find((item) => item.id === orderId);
    if (!order || !Array.isArray(order.items) || !order.items.length) {
      return { ok: false, message: "В заказе нет позиций для сканирования." };
    }
    if (["Собран", "Передан курьеру", "В пути", "Доставлен", "Отменен"].includes(order.status)) {
      return { ok: false, message: "Чеклист уже закрыт для этого статуса заказа." };
    }
    const match = order.items
      .map((item, index) => {
        const offer = this.pharmacyInventory.find((product) => product.id === item.offerId || product.catalogId === item.productId);
        const catalog = this.productById(item.productId || offer?.catalogId || offer?.id);
        const codes = [
          item.barcode,
          item.productId,
          item.offerId,
          offer?.barcode,
          offer?.id,
          offer?.catalogId,
          catalog?.id,
          catalog?.barcode,
          ...(Array.isArray(catalog?.barcodes) ? catalog.barcodes : []),
        ].filter(Boolean).map((entry) => String(entry).trim());
        return codes.includes(value) ? { item, index } : null;
      })
      .filter(Boolean)[0];
    if (!match) return { ok: false, message: "Код не найден в составе этого заказа." };
    if (match.item.collected) return { ok: true, order, message: `${match.item.name || "Позиция"} уже отмечена как собранная.` };
    const result = this.setOrderItemCollected(orderId, match.index, true);
    return result.ok
      ? { ...result, message: `${match.item.name || "Позиция"} отмечена по штрихкоду.` }
      : result;
  }

  setAllOrderItemsCollected(orderId, collected = true) {
    const order = this.orders.find((item) => item.id === orderId);
    if (!order || !Array.isArray(order.items) || !order.items.length) {
      return { ok: false, message: "В заказе нет позиций для отметки." };
    }
    if (["Собран", "Передан курьеру", "В пути", "Доставлен", "Отменен"].includes(order.status)) {
      return { ok: false, message: "Чеклист уже закрыт для этого статуса заказа." };
    }
    order.items.forEach((item) => {
      item.collected = Boolean(collected);
    });
    order.updatedAt = new Date().toISOString();
    this.addOrderHistory(order, {
      type: "checklist",
      icon: collected ? "check-circle" : "rotate-ccw",
      title: collected ? "Все позиции отмечены собранными" : "Отметки сборки сняты",
      details: `${order.items.length} позиций заказа обновлены одним действием.`,
      status: order.status,
      actor: "Аптека",
      createdAt: order.updatedAt,
    });
    this.saveOrders();
    return {
      ok: true,
      order,
      message: collected ? "Все позиции заказа отмечены как собранные." : "Отметки сборки сняты.",
    };
  }

  filterOrders(state = {}) {
    const query = this.normalizeLookup(state.query);
    const tab = state.tab || "Все";
    const dateFrom = String(state.dateFrom || "").trim();
    const dateTo = String(state.dateTo || "").trim();
    const type = String(state.type || "all");
    const sort = String(state.sort || "newest");
    const tabMatch = {
      "Новые": ["Новый"],
      "Подтвердить": ["Подтвержден"],
      "Сборка": ["Собирается", "Собран"],
      "Доставка": ["Передан курьеру", "В пути"],
      "Завершенные": ["Доставлен", "Отменен"],
    }[tab];
    const result = this.orders.filter((order) => {
      const matchesTab = !tabMatch || tabMatch.includes(order.status);
      const haystack = this.normalizeLookup([
        order.id,
        order.client,
        order.phone,
        order.district,
        order.address,
        order.productName,
        order.payment,
        order.type,
        ...(Array.isArray(order.items) ? order.items.map((item) => item.name) : []),
      ].join(" "));
      const orderDate = String(order.date || order.createdAt || "").slice(0, 10);
      const matchesDateFrom = !dateFrom || orderDate >= dateFrom;
      const matchesDateTo = !dateTo || orderDate <= dateTo;
      const matchesType = type === "all" || order.type === type;
      return matchesTab && matchesDateFrom && matchesDateTo && matchesType && (!query || haystack.includes(query));
    });
    return result.sort((a, b) => {
      if (sort === "amountDesc") return Number(b.amount || 0) - Number(a.amount || 0);
      if (sort === "amountAsc") return Number(a.amount || 0) - Number(b.amount || 0);
      if (sort === "status") return String(a.status || "").localeCompare(String(b.status || ""), "ru");
      const aTime = new Date(a.createdAt || `${a.date || ""}T${a.time || "00:00"}`).getTime() || 0;
      const bTime = new Date(b.createdAt || `${b.date || ""}T${b.time || "00:00"}`).getTime() || 0;
      return sort === "oldest" ? aTime - bTime : bTime - aTime;
    });
  }

  orderStats(orders = this.orders) {
    const count = (statuses) => orders.filter((order) => statuses.includes(order.status)).length;
    const amount = (statuses) => orders.filter((order) => statuses.includes(order.status)).reduce((sum, order) => sum + Number(order.amount || 0), 0);
    const completed = orders.filter((order) => order.status === "Доставлен");
    const active = orders.filter((order) => !["Доставлен", "Отменен"].includes(order.status));
    const nonCancelled = orders.filter((order) => order.status !== "Отменен");
    return {
      total: orders.length,
      new: count(["Новый"]),
      confirmed: count(["Подтвержден"]),
      assembly: count(["Собирается", "Собран"]),
      courier: count(["Передан курьеру", "В пути"]),
      completed: completed.length,
      cancelled: count(["Отменен"]),
      revenue: completed.reduce((sum, order) => sum + Number(order.amount || 0), 0),
      activeRevenue: active.reduce((sum, order) => sum + Number(order.amount || 0), 0),
      newAmount: amount(["Новый"]),
      confirmedAmount: amount(["Подтвержден"]),
      assemblyAmount: amount(["Собирается", "Собран"]),
      courierAmount: amount(["Передан курьеру", "В пути"]),
      averageCheck: nonCancelled.length ? Math.round(nonCancelled.reduce((sum, order) => sum + Number(order.amount || 0), 0) / nonCancelled.length) : 0,
      averageAssembly: completed.length ? Math.round(completed.reduce((sum, order) => sum + Number(order.duration || 0), 0) / completed.length) : 0,
    };
  }

  adminStats() {
    const pharmacyRecords = this.accounts.marketplacePharmacies();
    const orders = pharmacyRecords.flatMap(({ pharmacy }) => (pharmacy.orders || []).map((order) => new Order(order)));
    const inventory = pharmacyRecords.flatMap(({ pharmacy }) => pharmacy.inventory || []);
    const stats = this.orderStats(orders);
    const published = inventory.filter((item) => item.published !== false && Number(item.price) > 0);
    const lowStock = inventory.filter((item) => Number(item.stock) > 0 && Number(item.stock) <= 7);
    const outOfStock = inventory.filter((item) => Number(item.stock) <= 0);
    const needsModeration = inventory.filter((item) => item.moderationStatus && item.moderationStatus !== "Активен");
    const couriers = this.courierRoster();
    return {
      pharmacies: pharmacyRecords.length,
      sku: inventory.length,
      published: published.length,
      lowStock: lowStock.length,
      outOfStock: outOfStock.length,
      needsModeration: needsModeration.length,
      couriers: couriers.filter((courier) => courier.online).length,
      totalCouriers: couriers.length,
      orders,
      stats,
      commission: Math.round(stats.revenue * 0.075),
      activeRevenue: stats.activeRevenue,
      revenue: stats.revenue,
    };
  }

  analyticsOrders(period = "7") {
    const days = Number(period);
    if (!Number.isFinite(days) || days <= 0) return [...this.orders];
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(end.getDate() - days + 1);
    start.setHours(0, 0, 0, 0);
    return this.orders.filter((order) => {
      const date = new Date(`${order.date || end.toISOString().slice(0, 10)}T12:00:00`);
      return date >= start && date <= end;
    });
  }

  marketPriceFor(product) {
    const ownPharmacyId = this.accounts.activePharmacy()?.id;
    const prices = this.accounts.marketplacePharmacies()
      .flatMap(({ pharmacy }) => (pharmacy.inventory || []).map((offer) => ({ pharmacyId: pharmacy.id, offer })))
      .filter(({ pharmacyId, offer }) => {
        if (pharmacyId === ownPharmacyId && offer.id === product.id) return false;
        if (product.catalogId && offer.catalogId) return product.catalogId === offer.catalogId;
        return this.productKey(offer) === this.productKey(product);
      })
      .map(({ offer }) => Number(offer.price))
      .filter((price) => price > 0);
    if (!prices.length) return Number(product.marketPrice) || Number(product.price) || 0;
    return Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length);
  }

  productPricing(product) {
    const salePrice = Number(product.price) || 0;
    const purchasePrice = Number(product.purchasePrice) || Math.round(salePrice * 0.7);
    const marketPrice = this.marketPriceFor(product);
    const margin = salePrice > 0 ? Math.round(((salePrice - purchasePrice) / salePrice) * 1000) / 10 : 0;
    const promotion = product.promotion?.active ? product.promotion : null;
    return {
      salePrice,
      purchasePrice,
      marketPrice,
      margin,
      promotion,
      aboveMarket: marketPrice > 0 && salePrice > marketPrice,
    };
  }

  pricingStats() {
    const rows = this.pharmacyInventory.map((product) => this.productPricing(product));
    const activePromotions = rows.filter((row) => row.promotion).length;
    const averageMargin = rows.length
      ? Math.round(rows.reduce((sum, row) => sum + row.margin, 0) / rows.length * 10) / 10
      : 0;
    const aboveMarket = rows.filter((row) => row.aboveMarket).length;
    const threeDays = Date.now() + 3 * 24 * 60 * 60 * 1000;
    const endingSoon = rows.filter((row) => {
      const end = Date.parse(row.promotion?.endAt || "");
      return row.promotion && Number.isFinite(end) && end <= threeDays;
    }).length;
    return { activePromotions, averageMargin, aboveMarket, endingSoon };
  }

  updateProductPricing(productId, data = {}) {
    const product = this.pharmacyInventory.find((item) => item.id === productId);
    if (!product) return { ok: false, message: "Товар не найден." };
    const salePrice = Math.max(0, Number(data.salePrice) || 0);
    const purchasePrice = Math.max(0, Number(data.purchasePrice) || 0);
    if (!salePrice) return { ok: false, message: "Цена продажи должна быть больше нуля." };
    if (purchasePrice > salePrice) return { ok: false, message: "Закупочная цена не может быть выше цены продажи." };
    const previousPrice = Number(product.price) || 0;
    product.purchasePrice = purchasePrice;
    product.basePrice = salePrice;
    product.price = salePrice;
    product.promotion = null;
    product.priceHistory = Array.isArray(product.priceHistory) ? product.priceHistory : [];
    if (previousPrice !== salePrice) {
      product.priceHistory.push({ price: salePrice, previousPrice, changedAt: new Date().toISOString() });
      product.priceHistory = product.priceHistory.slice(-30);
    }
    product.updatedAt = new Date().toISOString();
    this.savePharmacyInventory();
    this.recordSyncEvent(`Цена обновлена: ${product.name}`, "Успешно", `${Format.money(previousPrice)} → ${Format.money(salePrice)}`);
    return { ok: true, product };
  }

  applyBulkPriceChange(percent, category = "") {
    const value = Number(percent);
    if (!Number.isFinite(value) || value === 0 || value < -90 || value > 200) {
      return { ok: false, message: "Укажите изменение от -90% до 200%." };
    }
    const products = this.pharmacyInventory.filter((product) => !category || product.category === category);
    if (!products.length) return { ok: false, message: "В выбранной категории нет товаров." };
    products.forEach((product) => {
      const previousPrice = Number(product.price) || 0;
      const base = Number(product.basePrice) || previousPrice;
      const nextBase = Math.max(100, Math.round(base * (1 + value / 100) / 100) * 100);
      product.basePrice = nextBase;
      product.price = product.promotion?.active
        ? Math.max(100, Math.round(nextBase * (1 - Number(product.promotion.discount) / 100) / 100) * 100)
        : nextBase;
      product.priceHistory = Array.isArray(product.priceHistory) ? product.priceHistory : [];
      product.priceHistory.push({ price: product.price, previousPrice, changedAt: new Date().toISOString() });
      product.priceHistory = product.priceHistory.slice(-30);
      product.updatedAt = new Date().toISOString();
    });
    this.savePharmacyInventory();
    this.recordSyncEvent(`Массовое изменение цен: ${products.length} товаров`, "Успешно", `${value > 0 ? "+" : ""}${value}%${category ? ` · ${category}` : ""}`);
    return { ok: true, count: products.length };
  }

  applyPromotion(data = {}) {
    const discount = Number(data.discount);
    const category = String(data.category || "");
    const endAt = String(data.endAt || "");
    if (!Number.isFinite(discount) || discount <= 0 || discount >= 90) {
      return { ok: false, message: "Скидка должна быть от 1% до 89%." };
    }
    if (!endAt || Date.parse(`${endAt}T23:59:59`) < Date.now()) {
      return { ok: false, message: "Укажите будущую дату окончания акции." };
    }
    const products = this.pharmacyInventory.filter((product) => !category || product.category === category);
    if (!products.length) return { ok: false, message: "В выбранной категории нет товаров." };
    products.forEach((product) => {
      const basePrice = Number(product.basePrice) || Number(product.price) || 0;
      product.basePrice = basePrice;
      product.price = Math.max(100, Math.round(basePrice * (1 - discount / 100) / 100) * 100);
      product.promotion = {
        active: true,
        title: String(data.title || `Скидка ${discount}%`).trim(),
        discount,
        endAt: `${endAt}T23:59:59`,
        createdAt: new Date().toISOString(),
      };
      product.priceHistory = Array.isArray(product.priceHistory) ? product.priceHistory : [];
      product.priceHistory.push({ price: product.price, previousPrice: basePrice, changedAt: new Date().toISOString(), promotion: true });
      product.priceHistory = product.priceHistory.slice(-30);
      product.updatedAt = new Date().toISOString();
    });
    this.savePharmacyInventory();
    this.recordSyncEvent(`Акция применена: ${products.length} товаров`, "Успешно", `${discount}% до ${new Date(`${endAt}T23:59:59`).toLocaleDateString("ru-RU")}`);
    return { ok: true, count: products.length };
  }

  analyticsSnapshot(period = "7") {
    const orders = this.analyticsOrders(period);
    const stats = this.orderStats(orders);
    const completed = orders.filter((order) => order.status === "Доставлен");
    const categoryMap = new Map();
    const paymentMap = new Map();
    const productMap = new Map();
    const dailyMap = new Map();
    let revenue = 0;
    let cost = 0;
    let deliveryRevenue = 0;
    let units = 0;

    completed.forEach((order) => {
      const items = Array.isArray(order.items) && order.items.length ? order.items : [{
        name: order.productName || "Товары заказа",
        category: order.category || "Без категории",
        price: Math.max(0, Number(order.amount) - Number(order.deliveryFee || 0)),
        quantity: Number(order.itemCount) || 1,
      }];
      let orderProductRevenue = 0;
      items.forEach((item) => {
        const quantity = Math.max(1, Number(item.quantity) || 1);
        const lineRevenue = Math.max(0, Number(item.price) || 0) * quantity;
        const inventoryItem = this.pharmacyInventory.find((product) => product.id === item.offerId || product.catalogId === item.productId);
        const lineCost = (Number(item.purchasePrice) || Number(inventoryItem?.purchasePrice) || Math.round((Number(item.price) || 0) * 0.7)) * quantity;
        const category = item.category || order.category || inventoryItem?.category || "Без категории";
        const name = item.name || order.productName || inventoryItem?.name || "Товар";
        orderProductRevenue += lineRevenue;
        revenue += lineRevenue;
        cost += lineCost;
        units += quantity;
        categoryMap.set(category, (categoryMap.get(category) || 0) + lineRevenue);
        const product = productMap.get(name) || { revenue: 0, sold: 0 };
        product.revenue += lineRevenue;
        product.sold += quantity;
        productMap.set(name, product);
      });
      deliveryRevenue += Number(order.deliveryFee) || 0;
      paymentMap.set(order.payment || "Не указано", (paymentMap.get(order.payment || "Не указано") || 0) + orderProductRevenue);
      const orderDate = order.date || String(order.deliveredAt || order.createdAt || new Date().toISOString()).slice(0, 10);
      dailyMap.set(orderDate, (dailyMap.get(orderDate) || 0) + orderProductRevenue);
    });

    return { orders, completed, stats, revenue, cost, profit: revenue - cost, deliveryRevenue, units, categoryMap, paymentMap, productMap, dailyMap };
  }

  inventoryStats() {
    const total = this.pharmacyInventory.length;
    const inStock = this.pharmacyInventory.filter((item) => item.stock > 7).length;
    const lowStock = this.pharmacyInventory.filter((item) => item.stock > 0 && item.stock <= 7).length;
    const outOfStock = this.pharmacyInventory.filter((item) => item.stock <= 0).length;
    return { total, inStock, lowStock, outOfStock };
  }

  loadCustomerLocation() {
    const user = this.accounts.currentUser();
    const hasAccountCoordinates = user?.latitude !== null
      && user?.latitude !== undefined
      && user?.latitude !== ""
      && user?.longitude !== null
      && user?.longitude !== undefined
      && user?.longitude !== ""
      && Number.isFinite(Number(user.latitude))
      && Number.isFinite(Number(user.longitude));
    if (hasAccountCoordinates) {
      return {
        latitude: Number(user.latitude),
        longitude: Number(user.longitude),
        label: user.address || "Моё местоположение",
        source: "account",
      };
    }
    try {
      const stored = JSON.parse(window.localStorage.getItem(this.customerLocationKey) || "null");
      if (Number.isFinite(Number(stored?.latitude)) && Number.isFinite(Number(stored?.longitude))) return stored;
    } catch {
      // Use the center of Tashkent until the patient shares a location.
    }
    return { latitude: 41.3111, longitude: 69.2797, label: "Центр Ташкента", source: "default" };
  }

  setCustomerLocation(location) {
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    const address = String(location.address || location.label || "").trim();
    this.customerLocation = {
      latitude,
      longitude,
      label: address || "Моё местоположение",
      source: location.source || "browser",
      address,
    };
    window.localStorage.setItem(this.customerLocationKey, JSON.stringify(this.customerLocation));
    const user = this.accounts.currentUser();
    if (user?.type === "patient") {
      user.latitude = latitude;
      user.longitude = longitude;
      if (address) user.address = address;
      this.accounts.saveUsers();
    }
    return true;
  }

  distanceKm(from, to) {
    const lat1 = Number(from?.latitude);
    const lng1 = Number(from?.longitude);
    const lat2 = Number(to?.latitude);
    const lng2 = Number(to?.longitude);
    if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
    const radians = (degrees) => degrees * (Math.PI / 180);
    const earthRadiusKm = 6371;
    const dLat = radians(lat2 - lat1);
    const dLng = radians(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  googleMapUrl(latitude, longitude, zoom = 15) {
    const apiKey = String(window.DORIGO_GOOGLE_MAPS_API_KEY || "").trim();
    if (apiKey) {
      return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(`${latitude},${longitude}`)}&zoom=${zoom}`;
    }
    return `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}&z=${zoom}&output=embed`;
  }

  googleDirectionsUrl(pharmacy, customer = this.customerLocation) {
    const origin = `${Number(customer.latitude)},${Number(customer.longitude)}`;
    const destination = `${Number(pharmacy.latitude)},${Number(pharmacy.longitude)}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  }

  googleRouteUrl(origin, destination) {
    const from = `${Number(origin?.latitude)},${Number(origin?.longitude)}`;
    const to = `${Number(destination?.latitude)},${Number(destination?.longitude)}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=driving`;
  }

  marketplaceOffers(productId) {
    const selected = this.productById(productId);
    if (!selected) return [];
    const selectedKey = this.productKey(selected);
    const location = this.customerLocation;

    const offers = this.accounts.marketplacePharmacies().flatMap((record) => {
      const pharmacy = record.pharmacy;
      return (pharmacy.inventory || [])
        .filter((offer) => offer.published !== false && Number(offer.price) > 0)
        .filter((offer) => {
          const offerKey = this.productKey(offer);
          return offer.catalogId === selected.catalogId
            || offer.catalogId === selected.id
            || offer.id === selected.id
            || offerKey === selectedKey;
        })
        .map((offer) => {
          const stock = Math.max(0, Number(offer.stock) || 0);
          const reserve = Math.max(0, Number(offer.reserve) || 0);
          const available = Math.max(0, stock - reserve);
          const distance = this.distanceKm(location, pharmacy);
          const radius = Number(pharmacy.delivery?.radius) || 8;
          const deliveryEnabled = pharmacy.delivery?.enabled !== false;
          const deliveryAvailable = deliveryEnabled && distance !== null && distance <= radius;
          const assemblyMinutes = Number(pharmacy.delivery?.assemblyMinutes) || 30;
          const deliveryMinutes = deliveryAvailable ? Math.round(assemblyMinutes + Math.max(15, distance * 5)) : null;
          const deliveryFee = Number(pharmacy.delivery?.fee) || 0;
          const totalPrice = (Number(offer.price) || 0) + (deliveryAvailable ? deliveryFee : 0);
          const documentsVerified = Array.isArray(pharmacy.documents)
            ? pharmacy.documents.some((document) => String(document.status || "").toLowerCase().includes("провер"))
            : false;
          const updatedAt = Date.parse(offer.updatedAt || "");
          const hoursFresh = Number.isFinite(updatedAt) ? Math.max(0, Math.round((Date.now() - updatedAt) / 36e5)) : null;
          const freshnessScore = hoursFresh === null ? 72 : Math.min(72, hoursFresh);
          const trustScore = 72
            + (documentsVerified ? 10 : 0)
            + (pharmacy.phone ? 4 : 0)
            + (pharmacy.email ? 4 : 0)
            + (available > 0 ? 5 : 0)
            + (deliveryAvailable ? 5 : 0);
          const rawQualityScore = Math.round(
            78
            - (Number(offer.price) || 0) / 30000
            - (distance ?? 12) * 1.7
            - (deliveryMinutes ?? 90) * 0.16
            - freshnessScore * 0.08
            + (deliveryAvailable ? 7 : 0)
            + (documentsVerified ? 6 : 0)
            + Math.min(available, 30) * 0.25,
          );
          const qualityScore = Math.max(1, Math.min(99, rawQualityScore));
          const advantages = [
            documentsVerified ? "документы проверены" : "",
            available > 0 ? `${available} шт. доступно` : "",
            distance !== null ? `${distance.toFixed(1)} км от вас` : "",
            deliveryAvailable && deliveryMinutes ? `доставка ${deliveryMinutes} мин` : pharmacy.delivery?.pickup !== false ? "самовывоз доступен" : "",
            hoursFresh !== null && hoursFresh <= 24 ? "остатки обновлены сегодня" : "",
          ].filter(Boolean).slice(0, 3);
          return {
            id: `${pharmacy.id}:${offer.id}`,
            pharmacyId: pharmacy.id,
            ownerId: record.ownerId,
            organization: record.organization,
            pharmacy,
            offer: new Product(offer),
            price: Number(offer.price) || 0,
            stock,
            reserve,
            available,
            distance,
            deliveryAvailable,
            pickupAvailable: pharmacy.delivery?.pickup !== false,
            deliveryMinutes,
            deliveryFee,
            totalPrice,
            trustScore: Math.min(100, trustScore),
            qualityScore,
            hoursFresh,
            advantages,
            directionsUrl: this.googleDirectionsUrl(pharmacy, location),
          };
        });
    });

    const byAvailability = (a, b) => Number(b.available > 0) - Number(a.available > 0);
    const sorters = {
      price: (a, b) => byAvailability(a, b) || a.price - b.price || (a.distance ?? Infinity) - (b.distance ?? Infinity),
      distance: (a, b) => byAvailability(a, b) || (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.price - b.price,
      fastest: (a, b) => byAvailability(a, b) || (a.deliveryMinutes ?? Infinity) - (b.deliveryMinutes ?? Infinity) || a.price - b.price,
      best: (a, b) => {
        return byAvailability(a, b) || b.qualityScore - a.qualityScore || a.totalPrice - b.totalPrice || (a.distance ?? Infinity) - (b.distance ?? Infinity);
      },
    };
    return offers.sort(sorters[this.offerSort] || sorters.best);
  }

  productKey(product) {
    return this.normalizeLookup([
      product.catalogId || "",
      product.name || "",
      product.dosage || "",
      product.form || "",
      product.packageSize || "",
    ].join(" "));
  }

  refreshMarketplaceProducts() {
    const catalogById = new Map(this.catalogProducts.map((product) => [product.id, product]));
    const catalogByKey = new Map(this.catalogProducts.map((product) => [this.productKey(product), product]));
    const groups = new Map();
    this.catalogProducts.forEach((product) => groups.set(product.id, []));
    this.accounts.marketplacePharmacies().forEach(({ pharmacy }) => {
      (pharmacy.inventory || []).forEach((rawOffer) => {
        if (rawOffer.published === false || Number(rawOffer.price) <= 0) return;
        const catalog = catalogById.get(rawOffer.catalogId);
        if (!catalog) return;
        const offer = new Product({ ...rawOffer, pharmacyId: pharmacy.id });
        const key = catalog.id;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(offer);
      });
    });

    this.products = Array.from(groups.entries()).map(([key, offers], index) => {
      const catalog = catalogById.get(key)
        || (offers[0] ? catalogByKey.get(this.productKey(offers[0])) : null);
      if (!catalog) return null;
      const source = catalog;
      const availableOffers = offers.filter((offer) => Math.max(0, Number(offer.stock) - Number(offer.reserve || 0)) > 0);
      const prices = offers.map((offer) => Number(offer.price)).filter((price) => price > 0);
      return new Product({
        ...source,
        id: catalog?.id || offers[0]?.catalogId || offers[0]?.id || `market-${index}`,
        catalogId: catalog?.id || offers[0]?.catalogId || null,
        price: prices.length ? Math.min(...prices) : 0,
        stock: offers.reduce((sum, offer) => sum + Math.max(0, Number(offer.stock) - Number(offer.reserve || 0)), 0),
        pharmacies: new Set(offers.map((offer) => offer.pharmacyId).filter(Boolean)).size || offers.length,
        status: availableOffers.length ? (source.rxRequired ? "Рецептурный" : "Без рецепта") : "Нет предложений",
        popularity: offers.length ? Math.max(...offers.map((offer) => Number(offer.popularity) || 0), 1) : Number(source.popularity) || 1,
        imageData: source.imageData || "",
        images: Ui.productImages(source),
      });
    }).filter(Boolean);
    if (!this.selectedProductId || !this.products.some((product) => product.id === this.selectedProductId)) {
      this.selectedProductId = this.products.find((product) => Number(product.price) > 0 && Number(product.stock) > 0)?.id
        || this.products.find((product) => Ui.productImages(product).length)?.id
        || this.products[0]?.id
        || null;
    }
  }

  productById(id) {
    return this.products.find((product) => product.id === id)
      || this.catalogProducts.find((product) => product.id === id)
      || null;
  }

  selectedOffer() {
    const offers = this.marketplaceOffers(this.selectedProductId);
    return offers.find((offer) => offer.id === this.selectedOfferId) || offers[0] || null;
  }

  isFavorite(productId) {
    return this.accounts.isFavorite(productId);
  }

  toggleFavorite(productId) {
    return this.accounts.toggleFavorite(productId);
  }

  favoriteProducts() {
    return this.accounts.patientFavorites()
      .map((id) => this.productById(id))
      .filter(Boolean);
  }

  createPatientOrder(data = {}) {
    const user = this.accounts.currentUser();
    const selected = this.selectedOffer();
    const product = this.productById(this.selectedProductId);
    if (!user || user.type !== "patient") return { ok: false, message: "Войдите как пациент, чтобы оформить заказ." };
    if (!selected || !product) return { ok: false, message: "Сначала выберите аптеку." };
    if (selected.available < 1) return { ok: false, message: "Товар закончился. Выберите другую аптеку." };

    const now = new Date();
    const type = data.type === "Самовывоз" ? "Самовывоз" : "Доставка";
    if (type === "Доставка" && !selected.deliveryAvailable) {
      return { ok: false, message: "Эта аптека находится вне зоны доставки. Выберите самовывоз или другую аптеку." };
    }
    if (type === "Доставка" && this.customerLocation.source === "default") {
      return { ok: false, message: "Укажите точную точку доставки на карте, чтобы курьер видел маршрут." };
    }
    if (type === "Доставка" && !String(data.address || user.address || "").trim()) {
      return { ok: false, message: "Укажите адрес доставки и проверьте точку на карте." };
    }
    const quantity = Math.max(1, Math.floor(Number(data.quantity) || 1));
    if (quantity > selected.available) {
      return { ok: false, message: `В аптеке доступно только ${selected.available} уп. Уменьшите количество или выберите другую аптеку.` };
    }
    const productsAmount = selected.price * quantity;
    const amount = productsAmount + (type === "Доставка" ? selected.deliveryFee : 0);
    const record = this.accounts.findMarketplacePharmacy(selected.pharmacyId);
    if (!record) return { ok: false, message: "Аптека больше недоступна." };
    const automation = record.pharmacy.orderAutomation || {};
    const autoConfirmed = Boolean(automation.autoConfirm) && amount <= (Number(automation.limit) || 0);
    const order = new Order({
      id: `DG-${String(Date.now()).slice(-6)}`,
      date: now.toISOString().slice(0, 10),
      time: now.toTimeString().slice(0, 5),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      clientId: user.id,
      client: user.name,
      phone: user.contact,
      address: String(data.address || user.address || "").trim(),
      district: String(data.address || user.address || "Ташкент").trim(),
      clientLatitude: Number(this.customerLocation.latitude),
      clientLongitude: Number(this.customerLocation.longitude),
      pharmacyId: selected.pharmacyId,
      pharmacyName: selected.pharmacy.name,
      pharmacyAddress: selected.pharmacy.address,
      pharmacyLatitude: Number(selected.pharmacy.latitude),
      pharmacyLongitude: Number(selected.pharmacy.longitude),
      amount,
      deliveryFee: type === "Доставка" ? selected.deliveryFee : 0,
      productsAmount,
      status: autoConfirmed ? "Подтвержден" : "Новый",
      autoConfirmed,
      duration: type === "Доставка" ? selected.deliveryMinutes : Number(selected.pharmacy.delivery?.assemblyMinutes) || 30,
      distance: selected.distance,
      offerScore: selected.qualityScore,
      offerTrustScore: selected.trustScore,
      offerAdvantages: selected.advantages,
      offerUpdatedAt: selected.offer.updatedAt || "",
      availableBeforeOrder: selected.available,
      availableAfterOrder: Math.max(0, selected.available - quantity),
      reservedQuantity: quantity,
      itemCount: quantity,
      type,
      payment: String(data.payment || "Наличные"),
      confirmationCode: String(Math.floor(1000 + Math.random() * 9000)),
      category: product.category,
      productName: product.name,
      items: [{
        productId: product.id,
        offerId: selected.offer.id,
        name: product.name,
        subtitle: product.subtitle,
        category: product.category,
        price: selected.price,
        purchasePrice: Number(selected.offer.purchasePrice) || Math.round(Number(selected.price) * 0.7),
        quantity,
        imageData: product.imageData || "",
        images: Ui.productImages(product),
        color: product.color,
      }],
      messages: [],
      statusHistory: [
        {
          id: `hist-${now.getTime()}-created`,
          type: "created",
          icon: "shopping-bag",
          title: "Заказ создан",
          details: `${user.name} оформил заказ в ${selected.pharmacy.name}.`,
          status: autoConfirmed ? "Подтвержден" : "Новый",
          actor: user.name,
          createdAt: now.toISOString(),
        },
        ...(autoConfirmed ? [{
          id: `hist-${now.getTime()}-auto-confirmed`,
          type: "status",
          icon: "check-circle",
          title: "Заказ автоподтвержден",
          details: `Сумма ${Format.money(amount)} в пределах лимита аптеки.`,
          status: "Подтвержден",
          actor: "DoriGo",
          createdAt: now.toISOString(),
        }] : []),
      ],
    });

    if (!Array.isArray(record.pharmacy.orders)) record.pharmacy.orders = [];
    record.pharmacy.orders.unshift({ ...order });
    if (!Array.isArray(record.pharmacy.syncEvents)) record.pharmacy.syncEvents = [];
    record.pharmacy.syncEvents.unshift({
      id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: autoConfirmed ? `Автоподтвержден заказ #${order.id}` : `Новый заказ #${order.id}`,
      status: "Успешно",
      details: autoConfirmed
        ? `Сумма ${Format.money(amount)} в пределах лимита ${Format.money(Number(automation.limit) || 0)}. Зарезервировано ${quantity} уп.`
        : `Заказ отправлен в кабинет аптеки. Зарезервировано ${quantity} уп., сумма ${Format.money(amount)}.`,
      createdAt: now.toISOString(),
    });
    record.pharmacy.syncEvents = record.pharmacy.syncEvents.slice(0, 50);
    const offerIndex = record.pharmacy.inventory.findIndex((item) => item.id === selected.offer.id);
    if (offerIndex >= 0) {
      record.pharmacy.inventory[offerIndex].reserve = Number(record.pharmacy.inventory[offerIndex].reserve || 0) + quantity;
      record.pharmacy.inventory[offerIndex].available = Math.max(
        0,
        Number(record.pharmacy.inventory[offerIndex].stock || 0) - Number(record.pharmacy.inventory[offerIndex].reserve || 0),
      );
    }
    this.persistMarketplaceRecord(record);
    this.accounts.addPatientOrder({ ...order });
    this.selectedPatientOrderId = order.id;
    this.checkoutMode = false;
    this.checkoutQuantity = 1;
    this.refreshMarketplaceProducts();
    return { ok: true, order };
  }

  patientOrders() {
    const user = this.accounts.currentUser();
    return user?.type === "patient" && Array.isArray(user.orders) ? user.orders.map((order) => new Order(order)) : [];
  }

  savePatientReview(orderId, data = {}) {
    const user = this.accounts.currentUser();
    if (!user || user.type !== "patient") {
      return { ok: false, message: "Войдите как пациент, чтобы оставить отзыв." };
    }
    if (!Array.isArray(user.orders)) user.orders = [];
    const patientOrder = user.orders.find((order) => order.id === orderId);
    if (!patientOrder) {
      return { ok: false, message: "Заказ не найден в истории пациента." };
    }
    if (patientOrder.status !== "Доставлен") {
      return { ok: false, message: "Отзыв можно оставить после доставки заказа." };
    }

    const parsedRating = Math.round(Number(data.rating) || 0);
    if (parsedRating < 1 || parsedRating > 5) {
      return { ok: false, message: "Поставьте оценку от 1 до 5." };
    }
    const text = String(data.text || "").trim();
    if (text.length < 4) {
      return { ok: false, message: "Напишите короткий отзыв о заказе." };
    }

    const now = new Date().toISOString();
    const review = {
      rating: Math.max(1, Math.min(5, parsedRating)),
      text,
      createdAt: patientOrder.review?.createdAt || now,
      updatedAt: now,
    };

    patientOrder.review = review;
    patientOrder.reviewedAt = now;
    this.addOrderHistory(patientOrder, {
      type: "review",
      icon: "star",
      title: "Пациент оставил отзыв",
      details: `Оценка ${review.rating}/5: ${text.slice(0, 120)}`,
      status: patientOrder.status,
      actor: user.name,
      createdAt: now,
    });
    this.accounts.saveUsers();

    const record = this.marketplaceOrderRecord(orderId);
    if (record?.order) {
      record.order.review = review;
      record.order.reviewedAt = now;
      this.addOrderHistory(record.order, {
        type: "review",
        icon: "star",
        title: "Пациент оставил отзыв",
        details: `Оценка ${review.rating}/5: ${text.slice(0, 120)}`,
        status: record.order.status,
        actor: user.name,
        createdAt: now,
      });
      this.persistMarketplaceRecord(record);
      this.accounts.syncOrderToPatients(record.order);
      this.syncActivePharmacyData();
    }

    return { ok: true, review, message: "Отзыв сохранен и теперь виден аптеке." };
  }

  sendOrderMessage(orderId, text) {
    const user = this.accounts.currentUser();
    const body = String(text || "").trim();
    if (!user || !["patient", "pharmacy"].includes(user.type)) {
      return { ok: false, message: "Войдите в аккаунт, чтобы написать сообщение." };
    }
    if (!orderId || body.length < 2) {
      return { ok: false, message: "Напишите сообщение по заказу." };
    }

    const record = this.marketplaceOrderRecord(orderId);
    if (!record?.order) {
      return { ok: false, message: "Заказ не найден для синхронизации чата." };
    }
    if (user.type === "patient") {
      const patientOrder = (user.orders || []).find((order) => order.id === orderId);
      if (!patientOrder) return { ok: false, message: "Заказ не найден в истории пациента." };
    }
    if (user.type === "pharmacy") {
      const activePharmacy = this.accounts.activePharmacy();
      if (activePharmacy?.id && activePharmacy.id !== record.pharmacy.id) {
        return { ok: false, message: "Этот заказ относится к другой аптеке." };
      }
    }

    const now = new Date().toISOString();
    const message = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      author: user.type === "pharmacy" ? "pharmacy" : "patient",
      name: user.name || (user.type === "pharmacy" ? record.pharmacy.name : record.order.client || "Пациент"),
      text: body.slice(0, 600),
      createdAt: now,
    };
    if (!Array.isArray(record.order.messages)) record.order.messages = [];
    record.order.messages.push(message);
    record.order.messages = record.order.messages.slice(-80);
    record.order.updatedAt = now;
    this.addOrderHistory(record.order, {
      type: "chat",
      icon: "message-circle",
      title: user.type === "pharmacy" ? "Аптека написала клиенту" : "Пациент написал аптеке",
      details: body.slice(0, 120),
      status: record.order.status,
      actor: message.name,
      createdAt: now,
    });
    if (!Array.isArray(record.pharmacy.syncEvents)) record.pharmacy.syncEvents = [];
    record.pharmacy.syncEvents.unshift({
      id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: user.type === "pharmacy" ? `Сообщение клиенту по заказу #${orderId}` : `Новое сообщение клиента по заказу #${orderId}`,
      status: "Успешно",
      details: body.slice(0, 120),
      createdAt: now,
    });
    record.pharmacy.syncEvents = record.pharmacy.syncEvents.slice(0, 50);
    this.persistMarketplaceRecord(record);
    this.accounts.syncOrderToPatients(record.order);
    this.syncActivePharmacyData();
    return { ok: true, message: user.type === "pharmacy" ? "Сообщение отправлено клиенту." : "Сообщение отправлено аптеке.", chatMessage: message };
  }

  prepareRepeatOrder(orderId) {
    const user = this.accounts.currentUser();
    if (!user || user.type !== "patient") {
      return { ok: false, message: "Войдите как пациент, чтобы повторить заказ." };
    }
    const sourceOrder = this.patientOrders().find((order) => order.id === orderId);
    if (!sourceOrder) {
      return { ok: false, message: "Заказ не найден в истории пациента." };
    }
    const firstItem = Array.isArray(sourceOrder.items) ? sourceOrder.items[0] : null;
    const product = this.productById(firstItem?.productId)
      || this.products.find((item) => this.normalizeLookup(item.name) === this.normalizeLookup(firstItem?.name || sourceOrder.productName));
    if (!product) {
      return { ok: false, message: "Товар из старого заказа больше не найден в каталоге." };
    }

    this.selectedProductId = product.id;
    this.refreshMarketplaceProducts();
    const offers = this.marketplaceOffers(product.id);
    const samePharmacyOffer = offers.find((offer) => (
      offer.pharmacyId === sourceOrder.pharmacyId
      && (offer.offer.id === firstItem?.offerId || offer.offer.catalogId === firstItem?.productId || offer.offer.catalogId === product.id)
      && offer.available > 0
    ));
    const availableOffer = samePharmacyOffer || offers.find((offer) => offer.available > 0);
    if (!availableOffer) {
      this.selectedOfferId = null;
      this.checkoutMode = false;
      return { ok: false, message: "Сейчас нет аптек с доступным остатком для этого товара." };
    }

    if (Number.isFinite(Number(sourceOrder.clientLatitude)) && Number.isFinite(Number(sourceOrder.clientLongitude))) {
      this.setCustomerLocation({
        latitude: Number(sourceOrder.clientLatitude),
        longitude: Number(sourceOrder.clientLongitude),
        address: sourceOrder.address || user.address || "",
        label: sourceOrder.address || "Адрес из прошлого заказа",
        source: "repeat-order",
      });
    }
    this.selectedOfferId = availableOffer.id;
    this.selectedPatientOrderId = sourceOrder.id;
    this.checkoutQuantity = Math.max(1, Math.min(Number(availableOffer.available) || 1, Number(firstItem?.quantity || sourceOrder.itemCount) || 1));
    this.checkoutMode = true;
    return {
      ok: true,
      message: samePharmacyOffer
        ? `Повторяем заказ #${sourceOrder.id}: выбрана та же аптека.`
        : `Повторяем заказ #${sourceOrder.id}: прежняя аптека недоступна, выбрана другая с остатком.`,
    };
  }

  loadCourierProfile() {
    let saved = {};
    try {
      saved = JSON.parse(window.localStorage.getItem(this.courierProfileKey) || "{}");
    } catch {
      saved = {};
    }
    return {
      name: String(saved.name || "Икром И."),
      phone: String(saved.phone || "+998 90 123-45-67"),
      transport: String(saved.transport || "Электровелосипед"),
      vehicleNumber: String(saved.vehicleNumber || ""),
      online: saved.online !== false,
      rating: Number(saved.rating) || 4.9,
      payoutRequests: Array.isArray(saved.payoutRequests) ? saved.payoutRequests : [],
    };
  }

  saveCourierProfile() {
    window.localStorage.setItem(this.courierProfileKey, JSON.stringify(this.courierProfile));
  }

  updateCourierProfile(data = {}) {
    this.courierProfile = {
      ...this.courierProfile,
      name: String(data.name || this.courierProfile.name).trim(),
      phone: String(data.phone || this.courierProfile.phone).trim(),
      transport: String(data.transport || this.courierProfile.transport).trim(),
      vehicleNumber: String(data.vehicleNumber || "").trim(),
      online: data.online !== false,
    };
    this.saveCourierProfile();
    return this.courierProfile;
  }

  courierPayoutRequests() {
    if (!Array.isArray(this.courierProfile.payoutRequests)) this.courierProfile.payoutRequests = [];
    return this.courierProfile.payoutRequests;
  }

  courierPayoutSummary() {
    const stats = this.courierStats();
    const requests = this.courierPayoutRequests().slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    const pending = requests.filter((request) => ["Создана", "В обработке"].includes(request.status));
    const paid = requests.filter((request) => request.status === "Выплачено");
    const pendingAmount = pending.reduce((sum, request) => sum + Number(request.amount || 0), 0);
    const paidAmount = paid.reduce((sum, request) => sum + Number(request.amount || 0), 0);
    return {
      stats,
      requests,
      pending,
      pendingAmount,
      paidAmount,
      available: Math.max(0, stats.earnings - paidAmount - pendingAmount),
    };
  }

  requestCourierPayout() {
    const summary = this.courierPayoutSummary();
    if (summary.pending.length) {
      return { ok: false, message: "У вас уже есть заявка на выплату в обработке." };
    }
    if (summary.available <= 0) {
      return { ok: false, message: "Доступной суммы для выплаты пока нет." };
    }
    const request = {
      id: `payout-${Date.now()}`,
      amount: summary.available,
      status: "Создана",
      createdAt: new Date().toISOString(),
      deliveredOrders: summary.stats.delivered,
    };
    this.courierPayoutRequests().unshift(request);
    this.saveCourierProfile();
    return { ok: true, request, message: `Заявка на выплату ${Format.money(request.amount)} создана.` };
  }

  courierRoster() {
    const activeOrders = this.courierOrders();
    const deliveredToday = activeOrders.filter((order) => (
      order.status === "Доставлен"
      && String(order.deliveredAt || order.date || "").slice(0, 10) === new Date().toISOString().slice(0, 10)
    ));
    const base = [
      { name: this.courierProfile.name, phone: this.courierProfile.phone, transport: this.courierProfile.transport, online: this.courierProfile.online, rating: this.courierProfile.rating },
      { name: "Руслан К.", phone: "+998 91 456-78-90", transport: "Мотоцикл", online: true, rating: 4.8 },
      { name: "Шахзод А.", phone: "+998 93 333-66-77", transport: "Автомобиль", online: true, rating: 4.7 },
      { name: "Темур Б.", phone: "+998 97 222-88-99", transport: "Велосипед", online: true, rating: 4.8 },
    ];
    const unique = new Map();
    base.forEach((courier) => {
      const name = String(courier.name || "").trim();
      if (!name || unique.has(name)) return;
      const assigned = activeOrders.filter((order) => order.courierName === name);
      const active = assigned.filter((order) => order.status !== "Доставлен");
      const delivered = deliveredToday.filter((order) => order.courierName === name);
      unique.set(name, {
        ...courier,
        name,
        active: active.length,
        deliveredToday: delivered.length,
        earningsToday: delivered.reduce((sum, order) => sum + this.courierFee(order), 0),
        status: !courier.online ? "Офлайн" : active.some((order) => order.status === "В пути") ? "Доставляет" : "Онлайн",
      });
    });
    return Array.from(unique.values()).sort((a, b) => b.active - a.active || b.deliveredToday - a.deliveredToday || a.name.localeCompare(b.name, "ru"));
  }

  courierFee(order) {
    const distance = Math.max(0, Number(order.distance) || 0);
    return Number(order.courierFee) || Math.max(12000, Math.round((7000 + distance * 1800) / 1000) * 1000);
  }

  applyCourierAssignment(order, courierName = "") {
    if (!order) return null;
    const roster = this.courierRoster();
    const requested = this.normalizeLookup(courierName);
    const courier = roster.find((item) => this.normalizeLookup(item.name) === requested)
      || roster.find((item) => item.online)
      || roster[0]
      || null;
    order.courierName = courier?.name || String(courierName || "Курьер DoriGo");
    if (courier) {
      order.courierPhone = courier.phone || order.courierPhone || "";
      order.courierTransport = courier.transport || order.courierTransport || "";
      order.courierRating = Number(courier.rating) || order.courierRating || 4.8;
    }
    if (!order.confirmationCode) order.confirmationCode = String(Math.floor(1000 + Math.random() * 9000));
    if (!order.courierFee) order.courierFee = this.courierFee(order);
    order.courierAssignedAt = order.courierAssignedAt || new Date().toISOString();
    return order;
  }

  courierStats() {
    const orders = this.courierOrders();
    const delivered = orders.filter((order) => order.status === "Доставлен");
    const today = new Date().toISOString().slice(0, 10);
    const todayOrders = delivered.filter((order) => String(order.deliveredAt || order.date || "").slice(0, 10) === today);
    return {
      total: orders.length,
      active: orders.filter((order) => order.status !== "Доставлен").length,
      delivered: delivered.length,
      todayDelivered: todayOrders.length,
      earnings: delivered.reduce((sum, order) => sum + this.courierFee(order), 0),
      todayEarnings: todayOrders.reduce((sum, order) => sum + this.courierFee(order), 0),
      distance: orders.reduce((sum, order) => sum + (Number(order.distance) || 0), 0),
    };
  }

  syncPharmacyOrdersWithLocation(pharmacyId = null) {
    const account = this.accounts.pharmacyAccount();
    const pharmacy = (account.pharmacies || []).find((item) => item.id === pharmacyId)
      || this.accounts.activePharmacy();
    if (!pharmacy || !Array.isArray(pharmacy.orders)) return 0;
    let changed = 0;
    pharmacy.orders.forEach((order) => {
      if (["Доставлен", "Отменен"].includes(order.status)) return;
      order.pharmacyId = pharmacy.id;
      order.pharmacyName = pharmacy.name;
      order.pharmacyAddress = pharmacy.address;
      order.pharmacyLatitude = Number(pharmacy.latitude);
      order.pharmacyLongitude = Number(pharmacy.longitude);
      const distance = this.distanceKm(
        { latitude: order.clientLatitude, longitude: order.clientLongitude },
        { latitude: pharmacy.latitude, longitude: pharmacy.longitude },
      );
      if (order.type === "Доставка" && distance !== null) {
        order.distance = distance;
        const assemblyMinutes = Number(pharmacy.delivery?.assemblyMinutes) || 30;
        order.duration = Math.round(assemblyMinutes + Math.max(15, distance * 5));
      }
      order.updatedAt = new Date().toISOString();
      this.accounts.syncOrderToPatients(order);
      changed += 1;
    });
    this.accounts.persistPharmacyAccount(account);
    this.syncActivePharmacyData();
    return changed;
  }

  courierOrders() {
    const orders = this.accounts.marketplacePharmacies()
      .flatMap(({ pharmacy }) => (pharmacy.orders || []).map((order) => {
        const active = !["Доставлен", "Отменен"].includes(order.status);
        const livePharmacy = {
          latitude: Number(pharmacy.latitude),
          longitude: Number(pharmacy.longitude),
        };
        const storedPharmacy = {
          latitude: Number.isFinite(Number(order.pharmacyLatitude)) ? Number(order.pharmacyLatitude) : livePharmacy.latitude,
          longitude: Number.isFinite(Number(order.pharmacyLongitude)) ? Number(order.pharmacyLongitude) : livePharmacy.longitude,
        };
        const pharmacyPoint = active ? livePharmacy : storedPharmacy;
        const distance = this.distanceKm(
          { latitude: order.clientLatitude, longitude: order.clientLongitude },
          pharmacyPoint,
        );
        const assemblyMinutes = Number(pharmacy.delivery?.assemblyMinutes) || 30;
        return new Order({
          ...order,
          pharmacyId: order.pharmacyId || pharmacy.id,
          pharmacyName: active ? pharmacy.name : (order.pharmacyName || pharmacy.name),
          pharmacyAddress: active ? pharmacy.address : (order.pharmacyAddress || pharmacy.address),
          pharmacyLatitude: pharmacyPoint.latitude,
          pharmacyLongitude: pharmacyPoint.longitude,
          distance: distance ?? order.distance,
          duration: order.type === "Доставка" && distance !== null
            ? Math.round(assemblyMinutes + Math.max(15, distance * 5))
            : order.duration,
        });
      }))
      .filter((order) => order.type === "Доставка" && ["Передан курьеру", "В пути", "Доставлен"].includes(order.status))
      .sort((a, b) => new Date(b.createdAt || `${b.date}T${b.time}`) - new Date(a.createdAt || `${a.date}T${a.time}`));
    if (!this.selectedCourierOrderId || !orders.some((order) => order.id === this.selectedCourierOrderId)) {
      this.selectedCourierOrderId = orders.find((order) => order.status !== "Доставлен")?.id || orders[0]?.id || null;
    }
    return orders;
  }

  currentCourierOrder() {
    const orders = this.courierOrders();
    return orders.find((order) => order.id === this.selectedCourierOrderId)
      || orders.find((order) => order.status !== "Доставлен")
      || orders[0]
      || null;
  }

  marketplaceOrderRecord(orderId) {
    for (const record of this.accounts.marketplacePharmacies()) {
      const order = (record.pharmacy.orders || []).find((item) => item.id === orderId);
      if (order) return { ...record, order };
    }
    return null;
  }

  persistMarketplaceRecord(record) {
    if (record?.ownerId === "workspace") this.accounts.saveWorkspace();
    else this.accounts.saveUsers();
  }

  assignCourier(orderId, courierName) {
    const record = this.marketplaceOrderRecord(orderId);
    if (!record || ["Доставлен", "Отменен"].includes(record.order.status)) return null;
    this.applyCourierAssignment(record.order, courierName);
    record.order.courierAssignedAt = new Date().toISOString();
    record.order.updatedAt = record.order.courierAssignedAt;
    this.addOrderHistory(record.order, {
      type: "courier",
      icon: "bike",
      title: "Курьер назначен",
      details: `${record.order.courierName || courierName || "Курьер"} назначен на доставку.`,
      status: record.order.status,
      actor: "Аптека",
      createdAt: record.order.updatedAt,
    });
    this.selectedCourierOrderId = record.order.id;
    this.persistMarketplaceRecord(record);
    this.accounts.syncOrderToPatients(record.order);
    this.syncActivePharmacyData();
    return new Order(record.order);
  }

  saveCourierPhoto(orderId, dataUrl, fileName = "") {
    const record = this.marketplaceOrderRecord(orderId);
    if (!record || !String(dataUrl || "").startsWith("data:image/")) return null;
    record.order.deliveryPhotoData = dataUrl;
    record.order.deliveryPhotoName = String(fileName || "delivery-photo");
    record.order.deliveryPhotoAt = new Date().toISOString();
    record.order.updatedAt = record.order.deliveryPhotoAt;
    this.addOrderHistory(record.order, {
      type: "courier",
      icon: "camera",
      title: "Фото вручения добавлено",
      details: fileName ? `Файл: ${fileName}` : "Курьер добавил фото подтверждения.",
      status: record.order.status,
      actor: record.order.courierName || "Курьер",
      createdAt: record.order.updatedAt,
    });
    this.persistMarketplaceRecord(record);
    this.accounts.syncOrderToPatients(record.order);
    this.syncActivePharmacyData();
    return new Order(record.order);
  }

  courierAdvanceOrder(orderId, details = {}) {
    this.lastCourierError = "";
    const record = this.marketplaceOrderRecord(orderId);
    if (!record) {
      this.lastCourierError = "Заказ не найден.";
      return null;
    }
    const order = record.order;
    const previousStatus = order.status;
    this.selectedCourierOrderId = order.id;
    if (!order.courierName || !order.courierPhone || !order.courierTransport) {
      this.applyCourierAssignment(order, order.courierName);
    }
    if (order.status === "Передан курьеру") {
      order.status = "В пути";
      order.pickedUpAt = new Date().toISOString();
      if (!order.confirmationCode) {
        order.confirmationCode = String(Math.floor(1000 + Math.random() * 9000));
      }
    } else if (order.status === "В пути") {
      const enteredCode = String(details.code || "").trim();
      if (!order.deliveryPhotoData) {
        this.lastCourierError = "Добавьте фото вручения заказа.";
        return null;
      }
      if (order.confirmationCode && enteredCode !== String(order.confirmationCode)) {
        this.lastCourierError = "Неверный код подтверждения. Уточните код у клиента.";
        return null;
      }
      order.status = "Доставлен";
      order.deliveredAt = new Date().toISOString();
      order.courierNote = String(details.note || "").trim();
      order.deliveryCode = enteredCode;
      (order.items || []).forEach((item) => {
        const offer = (record.pharmacy.inventory || []).find((product) => product.id === item.offerId || product.catalogId === item.productId);
        if (!offer) return;
        const quantity = Number(item.quantity) || 1;
        offer.stock = Math.max(0, Number(offer.stock) - quantity);
        offer.reserve = Math.max(0, Number(offer.reserve) - quantity);
        offer.available = Math.max(0, offer.stock - offer.reserve);
      });
    } else {
      this.lastCourierError = "Для этого заказа действие недоступно.";
      return null;
    }
    order.updatedAt = new Date().toISOString();
    this.addOrderHistory(order, {
      type: "courier",
      icon: order.status === "Доставлен" ? "check-circle" : "navigation",
      title: order.status === "Доставлен" ? "Заказ доставлен" : "Курьер забрал заказ",
      details: order.status === "Доставлен"
        ? (order.courierNote || "Курьер подтвердил вручение заказа.")
        : `${previousStatus} → ${order.status}`,
      status: order.status,
      actor: order.courierName || "Курьер",
      createdAt: order.updatedAt,
    });
    this.persistMarketplaceRecord(record);
    this.accounts.syncOrderToPatients(order);
    this.syncActivePharmacyData();
    this.refreshMarketplaceProducts();
    return new Order(order);
  }

  currentPatientOrder() {
    const orders = this.patientOrders();
    return orders.find((order) => order.id === this.selectedPatientOrderId) || orders[0] || null;
  }

  normalizeLookup(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replaceAll("ё", "е")
      .replace(/[^\p{L}\p{N}%]+/gu, " ")
      .replace(/\s+/g, " ");
  }

  findCatalogMatches(query, limit = 6) {
    const needle = this.normalizeLookup(query);
    if (needle.length < 2) return [];

    return this.catalogProducts
      .map((product) => {
        const name = this.normalizeLookup(product.name);
        const mnn = this.normalizeLookup(product.mnn);
        const subtitle = this.normalizeLookup(product.subtitle);
        const id = this.normalizeLookup(product.id);
        let score = 0;
        if (name === needle) score += 100;
        if (name.startsWith(needle)) score += 55;
        if (name.includes(needle)) score += 35;
        if (mnn === needle) score += 45;
        if (mnn.includes(needle)) score += 20;
        if (`${name} ${subtitle}`.includes(needle)) score += 15;
        if (id.includes(needle)) score += 10;
        return { product, score };
      })
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, "ru"))
      .slice(0, limit)
      .map((result) => result.product);
  }

  importPackageNumber(value) {
    const text = String(value || "").trim();
    const match = text.match(/(?:№|n|nº|no\.?|кол-?во|уп\.?)\s*(\d{1,4})/i) || text.match(/\b(\d{1,4})\s*(?:таб|капс|шт|амп|пак|саше)\b/i);
    return match ? match[1] : "";
  }

  importDosageText(data = {}) {
    const explicit = String(data.dosage || "").trim();
    const extracted = this.extractDosage([data.name, data.subtitle, data.form, data.packageSize].filter(Boolean).join(" "));
    const value = explicit || extracted;
    return this.normalizeLookup(value);
  }

  findCatalogProduct(data) {
    if (data.catalogId) {
      return this.catalogProducts.find((product) => product.id === data.catalogId) || null;
    }

    const barcode = String(data.barcode || "").trim();
    if (barcode) {
      const barcodeMatch = this.catalogProducts.find((product) => (
        product.barcode === barcode
        || (Array.isArray(product.barcodes) && product.barcodes.includes(barcode))
      ));
      if (barcodeMatch) return barcodeMatch;
    }

    const name = this.normalizeLookup(data.name);
    if (!name) return null;
      const rowText = this.normalizeLookup([
      data.name,
      data.mnn,
      data.ingredient,
      data.dosage,
      data.form,
      data.packageSize,
      data.manufacturer,
    ].filter(Boolean).join(" "));
    const rowMnn = this.normalizeLookup(data.mnn || data.ingredient || "");
    const rowDosage = this.importDosageText(data);
    const rowPackage = this.importPackageNumber([data.packageSize, data.name].filter(Boolean).join(" "));
    const rowForm = this.normalizeLookup(data.form || this.extractForm(String(data.name || "")));

    const candidates = this.catalogProducts
      .map((product) => {
        const productName = this.normalizeLookup(product.name);
        const productMnn = this.normalizeLookup(product.mnn || product.ingredient || "");
        const extractedProductDosage = this.extractDosage(product.subtitle || product.ingredient || "");
        const productDosage = this.normalizeLookup(product.dosage || extractedProductDosage);
        const productPackage = this.importPackageNumber([product.packageSize, product.subtitle, product.name].filter(Boolean).join(" "));
        const productForm = this.normalizeLookup(product.form || this.extractForm(product.subtitle || product.name || ""));
        const productText = this.normalizeLookup([
          product.name,
          product.subtitle,
          product.mnn,
          product.ingredient,
          product.dosage,
          product.form,
          product.packageSize,
          product.manufacturer,
        ].filter(Boolean).join(" "));
        const nameMatch = productName === name || rowText.includes(productName) || productText.includes(name);
        const mnnMatch = rowMnn && productMnn && rowMnn === productMnn;
        if (!nameMatch && !mnnMatch) return null;
        if (rowDosage && productDosage && rowDosage !== productDosage && !productText.includes(rowDosage)) return null;
        if (rowPackage && productPackage && rowPackage !== productPackage) return null;

        let score = 0;
        if (productName === name) score += 90;
        else if (nameMatch) score += 48;
        if (mnnMatch) score += 18;
        if (rowDosage && (productDosage === rowDosage || productText.includes(rowDosage))) score += 34;
        if (rowPackage && productPackage === rowPackage) score += 12;
        if (rowForm && productForm && (productForm === rowForm || productText.includes(rowForm))) score += 8;
        return { product, score, productName, productMnn, productDosage };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, "ru"));

    if (!candidates.length) return null;
    const top = candidates[0];
    const sameTop = candidates.filter((candidate) => candidate.score === top.score);
    if (sameTop.length > 1) return null;
    if (!rowDosage) {
      const related = candidates.filter((candidate) => (
        candidate.productName === top.productName
        || (rowMnn && candidate.productMnn === rowMnn)
        || rowText.includes(candidate.productName)
        || candidate.productName.includes(name)
      ));
      const dosageVariants = new Set(related.map((candidate) => candidate.productDosage).filter(Boolean));
      if (dosageVariants.size > 1) return null;
    }
    return top.product;
  }

  addPharmacyOffer(data) {
    const activePharmacy = this.accounts.activePharmacy();
    if (!activePharmacy) {
      return { ok: false, message: "Сначала создайте или выберите аптеку." };
    }
    const catalogProduct = String(data.catalogId || "").trim()
      ? this.catalogProducts.find((product) => product.id === String(data.catalogId).trim())
      : null;
    if (!catalogProduct) {
      return { ok: false, message: "Аптека может добавлять только препараты из единого каталога DoriGo." };
    }
    if (!(Number(data.price) > 0)) {
      return { ok: false, message: "Укажите цену препарата больше нуля." };
    }
    const barcode = String(data.barcode || "").trim();
    const existingIndex = this.pharmacyInventory.findIndex((item) => item.catalogId === catalogProduct.id);

    const stock = Math.max(0, Number(data.stock) || 0);
    const price = Math.max(0, Number(data.price) || 0);
    const reserve = existingIndex >= 0 ? Number(this.pharmacyInventory[existingIndex].reserve) || 0 : 0;
    const source = catalogProduct;
    const existingOffer = this.pharmacyInventory[existingIndex] || {};
    const offer = new Product({
      ...source,
      id: existingIndex >= 0
        ? this.pharmacyInventory[existingIndex].id
        : `offer-${catalogProduct.id}-${Math.random().toString(36).slice(2, 7)}`,
      catalogId: catalogProduct.id,
      name: catalogProduct.name,
      mnn: catalogProduct.mnn,
      ingredient: catalogProduct.ingredient,
      dosage: catalogProduct.dosage,
      form: catalogProduct.form,
      packageSize: catalogProduct.packageSize || "",
      subtitle: catalogProduct.subtitle || "",
      manufacturer: catalogProduct.manufacturer || "",
      category: catalogProduct.category || "Прочее",
      price,
      basePrice: Number(this.pharmacyInventory[existingIndex]?.basePrice) || price,
      purchasePrice: Number(data.purchasePrice) || Number(this.pharmacyInventory[existingIndex]?.purchasePrice) || Math.round(price * 0.7),
      promotion: this.pharmacyInventory[existingIndex]?.promotion || null,
      priceHistory: this.pharmacyInventory[existingIndex]?.priceHistory || [],
      stock,
      reserve,
      available: Math.max(0, stock - reserve),
      prescription: catalogProduct.prescriptionStatus || (catalogProduct.rxRequired ? "По рецепту" : "Без рецепта"),
      prescriptionStatus: catalogProduct.prescriptionStatus || (catalogProduct.rxRequired ? "По рецепту" : "Без рецепта"),
      rxRequired: Boolean(catalogProduct.rxRequired),
      barcode,
      expiry: String(data.expiry || "").trim(),
      imageData: catalogProduct.imageData || "",
      photoName: catalogProduct.photoName || "",
      images: Ui.productImages(catalogProduct),
      moderationStatus: "Активен",
      published: existingOffer.published !== false,
      pharmacyId: this.accounts.activePharmacy()?.id || null,
      pharmacies: 1,
      deliveryMinutes: 60,
      deliveryToday: true,
      popularity: Number(this.pharmacyInventory[existingIndex]?.popularity) || Date.now(),
      status: stock === 0 ? "Нет в наличии" : stock <= 7 ? "Мало" : catalogProduct.rxRequired ? "Рецептурный" : "Без рецепта",
      color: catalogProduct.color || "green",
      updatedAt: new Date().toISOString(),
    });

    const previousOffer = existingIndex >= 0 ? this.pharmacyInventory[existingIndex] : null;
    if (existingIndex >= 0) this.pharmacyInventory.splice(existingIndex, 1, offer);
    else this.pharmacyInventory.unshift(offer);
    this.ensureCategory(offer.category);
    if (!data.skipSave) {
      try {
        this.savePharmacyInventory();
      } catch {
        if (existingIndex >= 0) this.pharmacyInventory.splice(existingIndex, 1, previousOffer);
        else this.pharmacyInventory.shift();
        return { ok: false, message: "Не удалось сохранить предложение аптеки: хранилище браузера заполнено." };
      }
    }
    if (!data.skipSyncLog) {
      this.recordSyncEvent(
        existingIndex >= 0 ? `Обновлен товар: ${offer.name}` : `Добавлен товар: ${offer.name}`,
        "Успешно",
        `${Format.money(price)} · остаток ${stock} шт.`,
      );
    }

    return {
      ok: true,
      offer,
      updated: existingIndex >= 0,
      catalogMatch: true,
      moderation: false,
    };
  }

  parseImportNumber(value) {
    const normalized = String(value ?? "")
      .replace(/\s/g, "")
      .replace(/[^\d,.-]/g, "")
      .replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  importExpiryIssue(value, stock) {
    const normalized = Format.expiryInput(value);
    const stockCount = Math.floor(Number(stock) || 0);
    if (!normalized) {
      return stockCount > 0 ? "укажите срок годности для товара с остатком в формате ММ.ГГГГ или ГГГГ-ММ" : "";
    }
    const [year, month] = normalized.split("-").map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return "укажите срок годности в формате ММ.ГГГГ или ГГГГ-ММ";
    }
    const expiresAt = new Date(year, month, 0, 23, 59, 59, 999);
    if (expiresAt < new Date()) return `срок годности ${Format.expiryLabel(normalized)} уже истек`;
    return "";
  }

  importPharmacyRows(rows, meta = {}) {
    const summary = {
      uploaded: rows.length,
      recognized: 0,
      updated: 0,
      added: 0,
      errors: 0,
      invalid: 0,
      unmatched: 0,
      duplicates: 0,
      expiryErrors: 0,
      moderation: 0,
      details: [],
      problemRows: [],
      fileName: meta.fileName || "",
    };
    const inventorySnapshot = this.pharmacyInventory.map((item) => new Product({ ...item }));
    const categorySnapshot = this.categories.map((category) => ({ ...category }));
    let changed = 0;
    const seenCatalogRows = new Map();
    const addImportIssue = (index, row, type, reason) => {
      const line = index + 2;
      summary.details.push(`Строка ${line}: ${reason}`);
      summary.problemRows.push({
        line,
        type,
        reason,
        catalogId: row.catalogId || "",
        barcode: row.barcode || "",
        name: row.name || "",
        mnn: row.mnn || "",
        dosage: row.dosage || "",
        form: row.form || "",
        packageSize: row.packageSize || "",
        price: row.price ?? "",
        purchasePrice: row.purchasePrice ?? "",
        stock: row.stock ?? "",
        expiry: row.expiry || "",
      });
    };

    rows.forEach((row, index) => {
      const name = String(row.name || "").trim();
      const price = this.parseImportNumber(row.price);
      const stock = this.parseImportNumber(row.stock);
      const purchasePrice = row.purchasePrice === "" || row.purchasePrice === undefined ? "" : this.parseImportNumber(row.purchasePrice);
      const expiry = Format.expiryInput(row.expiry);
      if (!name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(stock) || stock < 0 || (purchasePrice !== "" && !Number.isFinite(purchasePrice))) {
        summary.errors += 1;
        summary.invalid += 1;
        addImportIssue(index, row, "Ошибка формата", "проверьте название, цену, закупочную цену и остаток");
        return;
      }
      const expiryIssue = this.importExpiryIssue(row.expiry, stock);
      if (expiryIssue) {
        summary.errors += 1;
        summary.invalid += 1;
        summary.expiryErrors += 1;
        addImportIssue(index, row, "Ошибка срока годности", expiryIssue);
        return;
      }

      const catalogProduct = this.findCatalogProduct({ ...row, name });
      if (!catalogProduct) {
        summary.errors += 1;
        summary.unmatched += 1;
        summary.moderation += 1;
        addImportIssue(index, row, "Не найдено в каталоге", `«${name}» не распознано в едином каталоге. Уточните дозировку/форму или добавьте карточку через администратора.`);
        return;
      }
      if (seenCatalogRows.has(catalogProduct.id)) {
        const firstLine = seenCatalogRows.get(catalogProduct.id);
        summary.errors += 1;
        summary.duplicates += 1;
        addImportIssue(index, row, "Дубликат товара", `та же карточка DoriGo уже есть в строке ${firstLine}. Оставьте одну строку с актуальной ценой и остатком.`);
        return;
      }
      seenCatalogRows.set(catalogProduct.id, index + 2);
      const result = this.addPharmacyOffer({
        ...row,
        catalogId: catalogProduct.id,
        price,
        purchasePrice,
        stock: Math.floor(stock),
        expiry,
        skipSyncLog: true,
        skipSave: true,
      });
      if (!result.ok) {
        summary.errors += 1;
        addImportIssue(index, row, "Не сохранено", result.message);
        return;
      }
      summary.recognized += 1;
      if (result.updated) summary.updated += 1;
      else summary.added += 1;
      if (result.moderation) summary.moderation += 1;
      changed += 1;
    });

    if (changed) {
      try {
        this.savePharmacyInventory();
      } catch {
        this.pharmacyInventory = inventorySnapshot;
        this.categories = categorySnapshot;
        this.saveCategories();
        const pharmacy = this.accounts.activePharmacy();
        if (pharmacy) pharmacy.inventory = inventorySnapshot.map((item) => ({ ...item }));
        summary.errors += changed;
        summary.invalid += changed;
        summary.details.unshift("Не удалось сохранить импорт: хранилище браузера заполнено. Изменения отменены.");
        summary.problemRows.unshift({
          line: "",
          type: "Системная ошибка",
          reason: "Не удалось сохранить импорт: хранилище браузера заполнено. Изменения отменены.",
          catalogId: "",
          barcode: "",
          name: "",
          mnn: "",
          dosage: "",
          form: "",
          packageSize: "",
          price: "",
          purchasePrice: "",
          stock: "",
          expiry: "",
        });
        summary.updated = 0;
        summary.added = 0;
        summary.recognized = 0;
      }
    }

    this.recordSyncEvent(
      `Excel импорт: ${summary.uploaded} строк${summary.fileName ? ` · ${summary.fileName}` : ""}`,
      summary.errors && !summary.recognized ? "Ошибка" : summary.errors ? "С ошибками" : "Успешно",
      `Распознано ${summary.recognized}, добавлено ${summary.added}, обновлено ${summary.updated}, не распознано ${summary.unmatched}, дубликаты ${summary.duplicates}, сроки ${summary.expiryErrors}, ошибки ${summary.invalid}`,
    );

    return summary;
  }

  createCatalog(seedProducts) {
    const rows = [
      ["paracetamol-500-n20", "Парацетамол", "500 мг, таблетки N20", "Жаропонижающие", "Парацетамол", "500 мг", "Таблетки", "Жаропонижающее и обезболивающее средство для информационной карточки каталога.", 2000, false],
      ["panadol-500-n12", "Панадол", "500 мг, таблетки N12", "Жаропонижающие", "Парацетамол", "500 мг", "Таблетки", "Препарат на основе парацетамола; перед применением смотрите инструкцию.", 9500, false],
      ["efferalgan-500-n16", "Эффералган", "500 мг, шипучие таблетки N16", "Жаропонижающие", "Парацетамол", "500 мг", "Таблетки", "Шипучая форма парацетамола для карточки аптечного каталога.", 18000, false],
      ["aspirin-500-n20", "Аспирин", "500 мг, таблетки N20", "Обезболивающие", "Ацетилсалициловая кислота", "500 мг", "Таблетки", "НПВП; карточка содержит справочную информацию, не заменяет инструкцию.", 12000, false],
      ["aspirin-cardio-100-n30", "Аспирин Кардио", "100 мг, таблетки N30", "Кардиология", "Ацетилсалициловая кислота", "100 мг", "Таблетки", "Кардиологическая форма; отпуск и применение по инструкции и рекомендации специалиста.", 32000, true],
      ["citramon-p-n10", "Цитрамон П", "таблетки N10", "Обезболивающие", "Парацетамол + кофеин + АСК", "комбинированный", "Таблетки", "Комбинированное средство от боли и температуры для карточки аптечного каталога.", 5200, false],
      ["analgin-500-n10", "Анальгин", "500 мг, таблетки N10", "Обезболивающие", "Метамизол натрия", "500 мг", "Таблетки", "Обезболивающее средство; перед применением проверьте ограничения.", 4500, false],
      ["ketorolac-10-n20", "Кеторолак", "10 мг, таблетки N20", "Обезболивающие", "Кеторолак", "10 мг", "Таблетки", "НПВП с ограничениями; карточка для сравнения предложений аптек.", 8200, true],
      ["ketonal-100-n20", "Кетонал", "100 мг, таблетки N20", "Обезболивающие", "Кетопрофен", "100 мг", "Таблетки", "НПВП; используйте только согласно инструкции.", 9500, true],
      ["naproxen-250-n30", "Напроксен", "250 мг, таблетки N30", "Обезболивающие", "Напроксен", "250 мг", "Таблетки", "НПВП для информационной карточки маркетплейса.", 26000, true],
      ["diclofenac-50-n20", "Диклофенак", "50 мг, таблетки N20", "Обезболивающие", "Диклофенак", "50 мг", "Таблетки", "НПВП; отпуск может требовать контроля аптеки.", 7000, true],
      ["diclofenac-gel-5-50", "Диклофенак гель", "5%, 50 г", "Гели и мази", "Диклофенак", "5%", "Гель", "Наружная форма НПВП для карточки товара.", 17000, false],
      ["nimesil-100-n10", "Нимесил", "100 мг, порошок N10", "Обезболивающие", "Нимесулид", "100 мг", "Порошок", "НПВП в пакетиках; проверяйте правила отпуска.", 43000, true],
      ["no-spa-40-n24", "Но-шпа", "40 мг, таблетки N24", "Спазмолитики", "Дротаверин", "40 мг", "Таблетки", "Спазмолитическое средство для справочной карточки.", 24000, false],
      ["drotaverine-40-n20", "Дротаверин", "40 мг, таблетки N20", "Спазмолитики", "Дротаверин", "40 мг", "Таблетки", "Спазмолитик; информация указана для каталога.", 6000, false],
      ["ibuprofen-long", "Ибупрофен Лонг", "800 мг, таблетки N10", "Обезболивающие", "Ибупрофен", "800 мг", "Таблетки", "Форма ибупрофена с повышенной дозировкой; проверьте инструкцию.", 12500, false],
      ["gel-ibuprofen", "Гель Ибупрофен 5%", "для наружного применения 50 г", "Гели и мази", "Ибупрофен", "5%", "Гель", "Наружное средство с ибупрофеном для аптечной карточки.", 15500, false],
      ["nurofen-kids", "Нурофен для детей", "суспензия с 3 месяцев, 150 мл", "Детские препараты", "Ибупрофен", "100 мг/5 мл", "Суспензия", "Детская форма ибупрофена; дозирование только по инструкции.", 16000, false],
      ["ibuklin-junior", "Ибуклин Юниор", "100 мг + 125 мг, таблетки N10", "Детские препараты", "Ибупрофен + Парацетамол", "100/125 мг", "Таблетки", "Комбинированная детская форма; карточка для сравнения аптек.", 9500, false],
      ["teraflu-powder-n10", "Терафлю", "порошок N10", "Простуда и грипп", "Парацетамол + фенилэфрин", "комбинированный", "Порошок", "Средство для симптомов простуды; перед применением смотрите инструкцию.", 7300, false],
      ["fervex-n8", "Фервекс", "порошок N8", "Простуда и грипп", "Парацетамол + фенирамин + витамин C", "комбинированный", "Порошок", "Комбинированный порошок для карточки простудных средств.", 42000, false],
      ["coldrex-n10", "Колдрекс", "порошок N10", "Простуда и грипп", "Парацетамол + фенилэфрин", "комбинированный", "Порошок", "Простудное средство; не является заменой консультации врача.", 39000, false],
      ["rinza-n10", "Ринза", "таблетки N10", "Простуда и грипп", "Парацетамол + кофеин + фенилэфрин", "комбинированный", "Таблетки", "Комбинированные таблетки для симптомов простуды.", 18000, false],
      ["xylometazoline-01-10", "Ксилометазолин", "0,1%, спрей 10 мл", "Противоотечные", "Ксилометазолин", "0,1%", "Спрей", "Назальный деконгестант; соблюдайте длительность применения.", 11000, false],
      ["otrivin-01-10", "Отривин", "0,1%, спрей 10 мл", "Противоотечные", "Ксилометазолин", "0,1%", "Спрей", "Назальный спрей; карточка для аптечного сравнения.", 28000, false],
      ["nazivin-005-10", "Називин", "капли 0,05%, 10 мл", "Противоотечные", "Оксиметазолин", "0,05%", "Капли", "Капли для носа; проверяйте возрастные ограничения.", 16000, false],
      ["pinosol-10", "Пиносол", "капли назальные 10 мл", "Противоотечные", "Эфирные масла", "10 мл", "Капли", "Средство для носа растительного состава в справочном каталоге.", 26000, false],
      ["ambroxol-30-n20", "Амброксол", "30 мг, таблетки N20", "Кашель и горло", "Амброксол", "30 мг", "Таблетки", "Муколитическое средство; применение по инструкции.", 9000, false],
      ["ambrobene-syrup-100", "Амбробене", "сироп 15 мг/5 мл, 100 мл", "Кашель и горло", "Амброксол", "15 мг/5 мл", "Сироп", "Сироп с амброксолом для карточки каталога.", 28000, false],
      ["bromhexine-8-n20", "Бромгексин", "8 мг, таблетки N20", "Кашель и горло", "Бромгексин", "8 мг", "Таблетки", "Муколитическое средство; информация справочная.", 7000, false],
      ["acc-200-n20", "АЦЦ", "200 мг, таблетки шипучие N20", "Кашель и горло", "Ацетилцистеин", "200 мг", "Таблетки", "Муколитик; перед применением смотрите инструкцию.", 44000, false],
      ["mukaltin-n10", "Мукалтин", "таблетки N10", "Кашель и горло", "Алтея лекарственного трава", "50 мг", "Таблетки", "Отхаркивающее средство растительного происхождения.", 3000, false],
      ["gedelix-syrup-100", "Геделикс", "сироп 100 мл", "Кашель и горло", "Плюща листьев экстракт", "100 мл", "Сироп", "Растительный сироп от кашля; перед применением смотрите инструкцию.", 49000, false],
      ["strepsils-n24", "Стрепсилс", "пастилки N24", "Кашель и горло", "Антисептические компоненты", "N24", "Пастилки", "Пастилки для горла; карточка не заменяет инструкцию.", 36000, false],
      ["tantum-verde-spray-30", "Тантум Верде", "спрей 30 мл", "Кашель и горло", "Бензидамин", "30 мл", "Спрей", "Средство для горла; используйте по инструкции.", 52000, false],
      ["miramistin-150", "Мирамистин", "раствор 150 мл", "Антисептики", "Мирамистин", "150 мл", "Раствор", "Антисептический раствор для справочной карточки.", 52000, false],
      ["chlorhexidine-005-100", "Хлоргексидин", "0,05%, раствор 100 мл", "Антисептики", "Хлоргексидин", "0,05%", "Раствор", "Антисептический раствор наружного применения.", 4000, false],
      ["hydrogen-peroxide-3-100", "Перекись водорода", "3%, 100 мл", "Антисептики", "Перекись водорода", "3%", "Раствор", "Антисептик для наружного применения.", 3500, false],
      ["iodine-5-10", "Йод", "5%, раствор 10 мл", "Антисептики", "Йод", "5%", "Раствор", "Антисептическое средство наружного применения.", 3000, false],
      ["brilliant-green-10", "Бриллиантовый зеленый", "1%, раствор 10 мл", "Антисептики", "Бриллиантовый зеленый", "1%", "Раствор", "Антисептический раствор наружного применения.", 2500, false],
      ["loratadine-10-n10", "Лоратадин", "10 мг, таблетки N10", "Аллергия", "Лоратадин", "10 мг", "Таблетки", "Антигистаминное средство для информационного каталога.", 8000, false],
      ["cetirizine-10-n10", "Цетиризин", "10 мг, таблетки N10", "Аллергия", "Цетиризин", "10 мг", "Таблетки", "Антигистаминное средство; уточняйте инструкцию.", 9000, false],
      ["suprastin-25-n20", "Супрастин", "25 мг, таблетки N20", "Аллергия", "Хлоропирамин", "25 мг", "Таблетки", "Антигистаминное средство; карточка для сравнения наличия.", 22000, false],
      ["desloratadine-5-n10", "Дезлоратадин", "5 мг, таблетки N10", "Аллергия", "Дезлоратадин", "5 мг", "Таблетки", "Антигистаминная карточка каталога.", 19000, false],
      ["fenistil-gel-30", "Фенистил гель", "30 г", "Аллергия", "Диметинден", "30 г", "Гель", "Наружный гель при кожных проявлениях аллергии; смотрите инструкцию.", 42000, false],
      ["activated-charcoal-n20", "Активированный уголь", "250 мг, таблетки N20", "Пищеварение", "Активированный уголь", "250 мг", "Таблетки", "Сорбент для справочной карточки каталога.", 3000, false],
      ["smecta-n10", "Смекта", "порошок N10", "Пищеварение", "Диосмектит", "3 г", "Порошок", "Сорбент; перед применением смотрите инструкцию.", 39000, false],
      ["enterosgel-225", "Энтеросгель", "паста 225 г", "Пищеварение", "Полиметилсилоксана полигидрат", "225 г", "Паста", "Энтеросорбент для карточки аптечного каталога.", 87000, false],
      ["loperamide-2-n10", "Лоперамид", "2 мг, капсулы N10", "Пищеварение", "Лоперамид", "2 мг", "Капсулы", "Противодиарейное средство; используйте с учетом противопоказаний.", 8000, false],
      ["rehydron-n10", "Регидрон", "порошок N10", "Пищеварение", "Соли для регидратации", "N10", "Порошок", "Средство для приготовления раствора регидратации.", 28000, false],
      ["pancreatin-n60", "Панкреатин", "таблетки N60", "Пищеварение", "Панкреатин", "N60", "Таблетки", "Ферментное средство; карточка не заменяет инструкцию.", 15000, false],
      ["mezim-n20", "Мезим", "таблетки N20", "Пищеварение", "Панкреатин", "N20", "Таблетки", "Ферментный препарат для справочного каталога.", 26000, false],
      ["festal-n20", "Фестал", "драже N20", "Пищеварение", "Панкреатин + компоненты желчи", "N20", "Драже", "Ферментное средство; проверяйте ограничения.", 33000, false],
      ["omeprazole-20-n20", "Омепразол", "20 мг, капсулы N20", "Пищеварение", "Омепразол", "20 мг", "Капсулы", "Средство для снижения кислотности; применение по инструкции.", 9000, false],
      ["pantoprazole-40-n20", "Пантопразол", "40 мг, таблетки N20", "Пищеварение", "Пантопразол", "40 мг", "Таблетки", "ИПП; карточка для учета наличия и цены.", 34000, true],
      ["almagel-170", "Алмагель", "суспензия 170 мл", "Пищеварение", "Алгелдрат + магния гидроксид", "170 мл", "Суспензия", "Антацидное средство; информация справочная.", 35000, false],
      ["espumisan-40-n25", "Эспумизан", "40 мг, капсулы N25", "Пищеварение", "Симетикон", "40 мг", "Капсулы", "Средство от вздутия; карточка для аптечного каталога.", 46000, false],
      ["duphalac-200", "Дюфалак", "сироп 200 мл", "Пищеварение", "Лактулоза", "200 мл", "Сироп", "Слабительное средство; применяйте по инструкции.", 65000, false],
      ["linex-n16", "Линекс", "капсулы N16", "Пищеварение", "Пробиотические бактерии", "N16", "Капсулы", "Пробиотический комплекс для справочной карточки.", 52000, false],
      ["vitamin-c-500-n20", "Витамин C", "500 мг, таблетки N20", "Витамины", "Аскорбиновая кислота", "500 мг", "Таблетки", "Витаминная добавка; карточка каталога.", 12000, false],
      ["ascorbinka-100-n10", "Аскорбинка", "100 мг, таблетки N10", "Витамины", "Аскорбиновая кислота", "100 мг", "Таблетки", "Витамин C в таблетках для справочной карточки.", 3000, false],
      ["vitamin-d3-2000-n60", "Витамин D3", "2000 ME, капсулы N60", "Витамины", "Холекальциферол", "2000 ME", "Капсулы", "Витаминная добавка; дозирование по инструкции.", 89000, false],
      ["calcium-d3-n60", "Кальций D3", "таблетки N60", "Витамины", "Кальций + витамин D3", "N60", "Таблетки", "Минерально-витаминный комплекс для карточки каталога.", 64000, false],
      ["zinc-25-n30", "Цинк", "25 мг, таблетки N30", "Витамины", "Цинк", "25 мг", "Таблетки", "Минеральная добавка; информация справочная.", 35000, false],
      ["magnesium-b6-n50", "Магний B6", "таблетки N50", "Витамины", "Магний + витамин B6", "N50", "Таблетки", "Минерально-витаминный комплекс.", 24000, false],
      ["folic-acid-1-n50", "Фолиевая кислота", "1 мг, таблетки N50", "Витамины", "Фолиевая кислота", "1 мг", "Таблетки", "Витаминная добавка; назначение уточняйте у специалиста.", 9000, false],
      ["b12-500-n30", "Витамин B12", "500 мкг, таблетки N30", "Витамины", "Цианокобаламин", "500 мкг", "Таблетки", "Витамин B12 для информационной карточки.", 28000, false],
      ["iron-forte-n30", "Железо Форте", "капсулы N30", "Витамины", "Железо", "N30", "Капсулы", "Железосодержащая добавка; перед применением смотрите инструкцию.", 42000, false],
      ["omega-3-1000-n60", "Омега-3", "1000 мг, капсулы N60", "БАДы", "Омега-3 кислоты", "1000 мг", "Капсулы", "БАД с омега-3 кислотами; карточка каталога.", 38000, false],
      ["fish-oil-n100", "Рыбий жир", "капсулы N100", "БАДы", "Рыбий жир", "N100", "Капсулы", "БАД; информация для витрины, не медицинская рекомендация.", 45000, false],
      ["multivitamin-n30", "Мультивитамины", "таблетки N30", "Витамины", "Комплекс витаминов", "N30", "Таблетки", "Комплекс витаминов для справочной карточки.", 58000, false],
      ["bepanten-30", "Бепантен", "мазь 30 г", "Гели и мази", "Декспантенол", "30 г", "Мазь", "Средство для наружного применения; смотрите инструкцию.", 52000, false],
      ["panthenol-spray-130", "Пантенол", "спрей 130 г", "Гели и мази", "Декспантенол", "130 г", "Спрей", "Наружная форма декспантенола для карточки.", 47000, false],
      ["levomekol-40", "Левомеколь", "мазь 40 г", "Гели и мази", "Хлорамфеникол + метилурацил", "40 г", "Мазь", "Наружное средство; проверяйте правила отпуска.", 16000, false],
      ["clotrimazole-1-20", "Клотримазол", "крем 1%, 20 г", "Гели и мази", "Клотримазол", "1%", "Крем", "Противогрибковое наружное средство; информация справочная.", 18000, false],
      ["acyclovir-5-5", "Ацикловир", "крем 5%, 5 г", "Гели и мази", "Ацикловир", "5%", "Крем", "Противовирусное наружное средство; смотрите инструкцию.", 14000, false],
      ["hydrocortisone-1-10", "Гидрокортизон", "мазь 1%, 10 г", "Гели и мази", "Гидрокортизон", "1%", "Мазь", "Гормональное наружное средство; отпуск и применение требуют контроля.", 12000, true],
      ["contractubex-20", "Контрактубекс", "гель 20 г", "Гели и мази", "Комбинированный состав", "20 г", "Гель", "Гель для ухода за рубцовой тканью; карточка каталога.", 74000, false],
      ["captopril-25-n20", "Каптоприл", "25 мг, таблетки N20", "Кардиология", "Каптоприл", "25 мг", "Таблетки", "Кардиологическое средство; отпуск по правилам аптеки.", 8000, true],
      ["enalapril-10-n20", "Эналаприл", "10 мг, таблетки N20", "Кардиология", "Эналаприл", "10 мг", "Таблетки", "Кардиологический препарат; карточка справочная.", 9000, true],
      ["amlodipine-5-n30", "Амлодипин", "5 мг, таблетки N30", "Кардиология", "Амлодипин", "5 мг", "Таблетки", "Кардиологический препарат; отпуск может быть рецептурным.", 18000, true],
      ["bisoprolol-5-n30", "Бисопролол", "5 мг, таблетки N30", "Кардиология", "Бисопролол", "5 мг", "Таблетки", "Кардиологический препарат; применение по назначению врача.", 22000, true],
      ["nitroglycerin-05-n40", "Нитроглицерин", "0,5 мг, таблетки N40", "Кардиология", "Нитроглицерин", "0,5 мг", "Таблетки", "Кардиологическое средство с особыми правилами применения.", 7000, true],
      ["validol-n10", "Валидол", "таблетки N10", "Кардиология", "Ментил изовалерат", "N10", "Таблетки", "Средство для справочной карточки каталога.", 5000, false],
      ["corvalol-25", "Корвалол", "капли 25 мл", "Кардиология", "Комбинированный состав", "25 мл", "Капли", "Седативное средство; проверяйте ограничения отпуска.", 12000, false],
      ["atorvastatin-20-n30", "Аторвастатин", "20 мг, таблетки N30", "Кардиология", "Аторвастатин", "20 мг", "Таблетки", "Гиполипидемический препарат; применение по назначению специалиста.", 42000, true],
      ["metformin-500-n60", "Метформин", "500 мг, таблетки N60", "Эндокринология", "Метформин", "500 мг", "Таблетки", "Препарат для контроля глюкозы; отпуск по правилам аптеки.", 24000, true],
      ["levothyroxine-50-n50", "Левотироксин", "50 мкг, таблетки N50", "Эндокринология", "Левотироксин", "50 мкг", "Таблетки", "Гормональный препарат; применение только по назначению врача.", 26000, true],
      ["amoxiclav-625-n14", "Амоксиклав", "625 мг, таблетки N14", "Антибиотики", "Амоксициллин + клавулановая кислота", "625 мг", "Таблетки", "Антибиотик; только бронь/отпуск по правилам аптеки.", 79000, true],
      ["azithromycin-500-n3", "Азитромицин", "500 мг, таблетки N3", "Антибиотики", "Азитромицин", "500 мг", "Таблетки", "Антибиотик; требует контроля рецепта и правил отпуска.", 28000, true],
      ["ceftriaxone-1g-vial", "Цефтриаксон", "1 г, флакон", "Антибиотики", "Цефтриаксон", "1 г", "Флакон", "Инъекционный антибиотик; в онлайн-витрине только информационная карточка.", 9000, true],
      ["ciprofloxacin-500-n10", "Ципрофлоксацин", "500 мг, таблетки N10", "Антибиотики", "Ципрофлоксацин", "500 мг", "Таблетки", "Антибиотик; отпуск по рецепту и правилам аптеки.", 18000, true],
      ["doxycycline-100-n10", "Доксициклин", "100 мг, капсулы N10", "Антибиотики", "Доксициклин", "100 мг", "Капсулы", "Антибиотик; карточка для контролируемого каталога.", 16000, true],
      ["cefixime-400-n5", "Цефиксим", "400 мг, капсулы N5", "Антибиотики", "Цефиксим", "400 мг", "Капсулы", "Антибиотик; требуется проверка рецепта.", 52000, true],
      ["saline-09-200", "Физраствор", "0,9%, 200 мл", "Медизделия", "Натрия хлорид", "0,9%", "Раствор", "Раствор для медицинских процедур; карточка товара.", 7000, false],
      ["thermometer-digital", "Термометр электронный", "1 шт", "Медизделия", "Медицинское изделие", "1 шт", "Медизделие", "Электронный термометр для домашнего контроля температуры.", 32000, false],
      ["tonometer-automatic", "Тонометр автоматический", "манжета 22-32 см", "Медизделия", "Медицинское изделие", "1 шт", "Медизделие", "Автоматический тонометр для измерения давления.", 456000, false],
      ["glucose-strips-n50", "Тест-полоски для глюкометра", "N50", "Медизделия", "Медицинское изделие", "N50", "Медизделие", "Расходные материалы для глюкометра.", 98000, false],
      ["plaster-n20", "Пластырь бактерицидный", "N20", "Медизделия", "Медицинское изделие", "N20", "Пластырь", "Бактерицидный пластырь для аптечной витрины.", 12000, false],
      ["medical-mask-n50", "Маска медицинская", "N50", "Медизделия", "Медицинское изделие", "N50", "Маска", "Медицинские маски для карточки товара.", 25000, false],
      ["antiseptic-gel-100", "Антисептический гель", "100 мл", "Антисептики", "Спиртовой антисептик", "100 мл", "Гель", "Гель для обработки рук; товар аптечной витрины.", 14000, false],
      ["pregnancy-test", "Тест на беременность", "1 шт", "Медизделия", "Диагностический тест", "1 шт", "Тест", "Экспресс-тест для домашней диагностики.", 15000, false],
      ["bandage-sterile", "Бинт стерильный", "7 м x 14 см", "Медизделия", "Медицинское изделие", "7 м", "Бинт", "Стерильный бинт для аптечного каталога.", 6000, false],
      ["syringe-5ml-n10", "Шприц одноразовый", "5 мл, N10", "Медизделия", "Медицинское изделие", "5 мл", "Шприц", "Одноразовый шприц; медицинское изделие.", 10000, false],
      ["diapers-adult-m-n10", "Подгузники для взрослых", "размер M, N10", "Медизделия", "Гигиеническое изделие", "N10", "Гигиена", "Гигиеническое изделие для ухода.", 78000, false],
      ["baby-diapers-n20", "Подгузники детские", "размер 3, N20", "Мама и ребенок", "Гигиеническое изделие", "N20", "Гигиена", "Детские подгузники для витрины.", 69000, false],
      ["baby-cream-75", "Детский крем", "75 мл", "Мама и ребенок", "Уходовая косметика", "75 мл", "Крем", "Средство ухода для детской кожи.", 18000, false],
      ["sunscreen-spf50-50", "Солнцезащитный крем SPF50", "50 мл", "Красота и уход", "Уходовая косметика", "50 мл", "Крем", "Солнцезащитное средство для аптечной витрины.", 68000, false],
      ["hyaluronic-drops-10", "Увлажняющие капли", "10 мл", "Красота и уход", "Гиалуроновая кислота", "10 мл", "Капли", "Увлажняющие капли для глаз; смотрите инструкцию.", 39000, false],
      ["magnesium-b6-forte-n30", "Магний B6 Форте", "таблетки N30", "Витамины", "Магний + витамин B6", "N30", "Таблетки", "Минерально-витаминный комплекс.", 54000, false],
      ["propolis-spray-30", "Прополис спрей", "30 мл", "Кашель и горло", "Прополис", "30 мл", "Спрей", "Спрей для горла растительного состава.", 22000, false],
      ["salbutamol-inhaler", "Сальбутамол", "аэрозоль 100 мкг/доза", "Респираторные", "Сальбутамол", "100 мкг", "Ингалятор", "Бронхолитик; отпуск и применение по назначению специалиста.", 36000, true],
      ["berodual-solution-20", "Беродуал", "раствор для ингаляций 20 мл", "Респираторные", "Ипратропий + фенотерол", "20 мл", "Раствор", "Средство для ингаляций; требует контроля специалиста.", 72000, true],
      ["nasonex-spray", "Назонекс", "спрей назальный", "Аллергия", "Мометазон", "спрей", "Спрей", "Гормональный назальный спрей; применение по назначению врача.", 98000, true],
      ["cromogexal-drops", "Кромогексал", "капли глазные 2%, 10 мл", "Аллергия", "Кромоглициевая кислота", "2%", "Капли", "Противоаллергические глазные капли.", 44000, false],
    ];

    const generated = rows.map((row, index) => this.productFromRow(row, index));
    const byId = new Map();
    [...seedProducts, ...generated].forEach((product, index) => {
      byId.set(product.id, this.normalizeProduct(product, index));
    });

    return Array.from(byId.values());
  }

  productFromRow(row, index) {
    const [id, name, subtitle, category, ingredient, dosage, form, description, price, rxRequired] = row;
    return new Product({
      id,
      name,
      subtitle,
      category,
      ingredient,
      dosage,
      form,
      description,
      price,
      rxRequired,
      pharmacies: 18 + ((index * 11) % 190),
      stock: index % 13 === 0 ? 0 : index % 7 === 0 ? 3 + (index % 4) : 12 + ((index * 5) % 155),
      reserve: index % 9,
      color: this.colorFor(category, index),
      status: rxRequired ? "Рецептурный" : "Без рецепта",
      mnn: ingredient,
      deliveryMinutes: 35 + ((index * 7) % 85),
      deliveryToday: index % 5 !== 0,
      rating: 4.3 + ((index % 7) * 0.1),
      dosageGroup: this.dosageGroup(dosage),
      popularity: 1000 - index * 4,
    });
  }

  normalizeProduct(product, index) {
    const clean = (value, fallback = "") => Format.cleanText(value, fallback);
    const category = clean(product.category, "Прочее");
    const packageSize = clean(product.packageSize);
    const dosage = clean(product.dosage) || this.extractDosage(clean(product.subtitle) || clean(product.ingredient));
    const form = clean(product.form) || this.extractForm(clean(product.subtitle));
    const subtitle = clean(product.subtitle) || [dosage, form, packageSize].filter(Boolean).join(", ");
    const rxRequired = Boolean(product.rxRequired || product.rx || category === "Антибиотики");
    const stock = Number.isFinite(product.stock) ? product.stock : 10 + (index % 80);

    return new Product({
      ...product,
      name: clean(product.name, "Товар"),
      subtitle,
      ingredient: clean(product.ingredient),
      manufacturer: clean(product.manufacturer),
      category,
      dosage,
      form,
      packageSize,
      rxRequired,
      description: product.sourceVerified ? clean(product.description) : "",
      usage: product.sourceVerified ? clean(product.usage) : "",
      composition: product.sourceVerified ? clean(product.composition || product.ingredient) : "",
      indications: product.sourceVerified ? clean(product.indications) : "",
      contraindications: product.sourceVerified ? clean(product.contraindications) : "",
      storageConditions: product.sourceVerified ? clean(product.storageConditions) : "",
      fullTradeName: clean(product.fullTradeName || product.name),
      dosageFormDetails: clean(product.dosageFormDetails),
      pharmacotherapeuticGroup: clean(product.pharmacotherapeuticGroup),
      country: clean(product.country),
      registrationNumber: clean(product.registrationNumber),
      registrationDate: clean(product.registrationDate),
      registrationChangeDate: clean(product.registrationChangeDate),
      atcCode: clean(product.atcCode),
      instructionUrl: clean(product.instructionUrl),
      officialRegistryId: clean(product.officialRegistryId),
      officialPackageId: clean(product.officialPackageId),
      officialPackageName: clean(product.officialPackageName),
      officialMedicineName: clean(product.officialMedicineName),
      officialRegistrationStartDate: clean(product.officialRegistrationStartDate),
      officialUpdatedAt: clean(product.officialUpdatedAt),
      officialRetailPrice: clean(product.officialRetailPrice),
      officialInstructionLanguage: clean(product.officialInstructionLanguage),
      officialSyncedAt: clean(product.officialSyncedAt),
      sourceName: clean(product.sourceName),
      sourceUrl: clean(product.sourceUrl),
      sourceUpdatedAt: clean(product.sourceUpdatedAt),
      sourceDocument: clean(product.sourceDocument),
      sourceVerified: Boolean(product.sourceVerified),
      images: Array.isArray(product.images) ? product.images : [],
      imageMatch: product.imageMatch && typeof product.imageMatch === "object" ? product.imageMatch : null,
      prescriptionStatus: clean(product.prescriptionStatus, rxRequired ? "По рецепту" : "Без рецепта"),
      price: product.price || 5000 + index * 700,
      pharmacies: product.pharmacies || 20 + (index % 120),
      stock,
      reserve: Number.isFinite(product.reserve) ? product.reserve : index % 6,
      color: product.color || this.colorFor(category, index),
      status: stock === 0 ? "Нет в наличии" : rxRequired ? "Рецептурный" : clean(product.status, "Без рецепта"),
      mnn: clean(product.mnn || product.ingredient || product.name, clean(product.name, "Не указано")),
      deliveryMinutes: product.deliveryMinutes || 35 + ((index * 7) % 80),
      deliveryToday: product.deliveryToday !== false,
      rating: product.rating || 4.3 + ((index % 7) * 0.1),
      dosageGroup: product.dosageGroup || this.dosageGroup(dosage),
      popularity: product.popularity || 1000 - index * 3,
    });
  }

  extractDosage(text) {
    return (String(text || "").match(/\d+[\d,.]*\s?(мг|мкг|г|мл|ME|%)/i) || [""])[0];
  }

  extractForm(text) {
    const value = text.toLowerCase();
    if (value.includes("капсул")) return "Капсулы";
    if (value.includes("сироп")) return "Сироп";
    if (value.includes("спрей")) return "Спрей";
    if (value.includes("гель")) return "Гель";
    if (value.includes("мазь")) return "Мазь";
    if (value.includes("капл")) return "Капли";
    if (value.includes("порош")) return "Порошок";
    if (value.includes("раствор")) return "Раствор";
    if (value.includes("суспенз")) return "Суспензия";
    return "Таблетки";
  }

  dosageGroup(dosage) {
    if (!dosage) return "Другая";
    if (/100\s?мг/i.test(dosage)) return "100 мг";
    if (/200\s?мг/i.test(dosage)) return "200 мг";
    if (/400\s?мг/i.test(dosage)) return "400 мг";
    if (/500\s?мг/i.test(dosage)) return "500 мг";
    if (/800\s?мг/i.test(dosage)) return "800 мг";
    if (/%/.test(dosage)) return "Наружные %";
    if (/мл/i.test(dosage)) return "Жидкая форма";
    return "Другая";
  }

  colorFor(category, index) {
    const colors = {
      "Витамины": "blue",
      "БАДы": "orange",
      "Антибиотики": "red",
      "Аллергия": "purple",
      "Медизделия": "green",
      "Простуда и грипп": "blue",
      "Кашель и горло": "green",
      "Пищеварение": "orange",
      "Гели и мази": "purple",
      "Кардиология": "red",
    };
    return colors[category] || ["blue", "green", "orange", "purple", "red"][index % 5];
  }

  popularProducts(limit = 18) {
    return [...this.products]
      .filter((product) => this.isCategoryOnline(product.category))
      .sort((a, b) => {
        const imageDifference = Ui.productImages(b).length - Ui.productImages(a).length;
        return imageDifference || (Number(b.popularity) || 0) - (Number(a.popularity) || 0);
      })
      .slice(0, limit);
  }

  homeCategoryText(product) {
    return this.normalizeLookup([
      product.name,
      product.fullTradeName,
      product.mnn,
      product.ingredient,
      product.pharmacotherapeuticGroup,
      product.category,
      product.form,
      product.dosageFormDetails,
      product.description,
    ].join(" "));
  }

  matchesHomeCategory(product, category) {
    if (!product || category === "all") return true;
    const text = this.homeCategoryText(product);
    const atcCode = String(product.atcCode || "").toUpperCase();
    const includesAny = (terms) => terms.some((term) => text.includes(term));

    if (category === "otc") {
      return product.rxRequired === false || this.normalizeLookup(product.prescriptionStatus).includes("без рецепта");
    }
    if (category === "supplements") {
      return this.normalizeLookup(product.category).includes("спортивное питание") || includesAny([
        "бад",
        "биологически активн",
        "пищевая добавк",
        "омега",
        "рыбий жир",
        "пробиотик",
        "лактобакт",
        "бифидобакт",
        "lactobac",
        "bifidobac",
      ]);
    }
    if (category === "sports") {
      return this.normalizeLookup(product.category).includes("спортивное питание");
    }
    if (category === "vitamins") {
      return /^A1[12]/.test(atcCode) || includesAny([
        "витамин",
        "минерал",
        "аскорбин",
        "кальци",
        "магни",
        "цинк",
      ]);
    }
    if (category === "beauty") {
      return this.normalizeLookup(product.category).includes("дерматолог")
        || includesAny(["космет", "уход за", "кожа", "волос", "акне"]);
    }
    if (category === "mother") {
      return includesAny([
        "для детей",
        "детск",
        "ребен",
        "младен",
        "беремен",
        "лактац",
        "для мам",
      ]);
    }
    if (category === "medical") {
      const form = this.normalizeLookup(product.form);
      const identityText = this.normalizeLookup([
        product.name,
        product.fullTradeName,
        product.category,
        product.form,
      ].join(" "));
      return ["пластырь", "повязка", "салфетка"].some((item) => form.includes(item))
        || [
          "медицинское издел",
          "гигиен",
          "бинт",
          "шприц",
          "тест полос",
          "термометр",
          "тонометр",
          "катетер",
          "маска медицин",
          "подгузник",
        ].some((term) => identityText.includes(term));
    }
    return true;
  }

  homeCategoryProducts(category = "all", limit = 18) {
    return [...this.products]
      .filter((product) => this.isCategoryOnline(product.category))
      .filter((product) => this.matchesHomeCategory(product, category))
      .sort((a, b) => {
        const imageDifference = Ui.productImages(b).length - Ui.productImages(a).length;
        const offerDifference = (Number(b.pharmacies) || 0) - (Number(a.pharmacies) || 0);
        return imageDifference
          || offerDifference
          || (Number(b.popularity) || 0) - (Number(a.popularity) || 0)
          || a.name.localeCompare(b.name, "ru");
      })
      .slice(0, limit);
  }

  relatedProducts(product, limit = 18) {
    if (!product) return [];
    const target = {
      name: this.normalizeLookup(product.name),
      mnn: this.normalizeLookup(product.mnn || product.ingredient),
      category: this.normalizeLookup(product.category),
      form: this.normalizeLookup(product.form),
      dosage: this.normalizeLookup(product.dosage),
    };
    const targetNameTokens = new Set(target.name.split(" ").filter((token) => token.length > 3));
    const scored = this.products
      .filter((candidate) => candidate.id !== product.id && this.isCategoryOnline(candidate.category))
      .map((candidate) => {
        const candidateName = this.normalizeLookup(candidate.name);
        const candidateMnn = this.normalizeLookup(candidate.mnn || candidate.ingredient);
        const candidateCategory = this.normalizeLookup(candidate.category);
        const candidateForm = this.normalizeLookup(candidate.form);
        const candidateDosage = this.normalizeLookup(candidate.dosage);
        const sharedNameToken = candidateName
          .split(" ")
          .some((token) => token.length > 3 && targetNameTokens.has(token));
        let score = 0;
        if (target.mnn && candidateMnn === target.mnn) score += 120;
        if (target.name && candidateName === target.name) score += 90;
        if (sharedNameToken) score += 55;
        if (target.category && candidateCategory === target.category) score += 35;
        if (target.form && candidateForm === target.form) score += 16;
        if (target.dosage && candidateDosage === target.dosage) score += 14;
        return {
          product: candidate,
          score,
          hasImage: Ui.productImages(candidate).length > 0,
        };
      })
      .filter((item) => item.score >= 35)
      .sort((a, b) => {
        if (a.hasImage !== b.hasImage) return a.hasImage ? -1 : 1;
        return b.score - a.score
          || (Number(b.product.popularity) || 0) - (Number(a.product.popularity) || 0)
          || a.product.name.localeCompare(b.product.name, "ru");
      });
    const related = scored
      .filter((item) => item.hasImage)
      .map((item) => item.product);
    if (related.length < Math.min(8, limit)) {
      const used = new Set([product.id, ...related.map((item) => item.id)]);
      this.popularProducts(this.products.length)
        .filter((candidate) => Ui.productImages(candidate).length > 0)
        .forEach((candidate) => {
        if (related.length >= limit || used.has(candidate.id)) return;
        used.add(candidate.id);
        related.push(candidate);
      });
    }
    return related.slice(0, limit);
  }

  searchProducts(filters = {}) {
    const query = (filters.query || "").trim().toLowerCase();
    const minPrice = Number(filters.minPrice) || 0;
    const maxPrice = Number(filters.maxPrice) || Infinity;

    let products = this.products.filter((product) => {
      const text = [
        product.id,
        product.name,
        product.subtitle,
        product.category,
        product.ingredient,
        product.mnn,
        product.description,
        product.dosage,
        product.form,
      ]
        .join(" ")
        .toLowerCase();

      const queryMatch = !query || text.includes(query);
      const categoryMatch = !filters.categories?.size || filters.categories.has(product.category);
      const formMatch = !filters.forms?.size || filters.forms.has(product.form);
      const dosageMatch = !filters.dosages?.size || filters.dosages.has(product.dosageGroup);
      const priceMatch = product.price >= minPrice && product.price <= maxPrice;
      const stockMatch = !filters.inStock || product.stock > 0;
      const deliveryMatch = !filters.deliveryToday || product.deliveryToday;
      const otcMatch = !filters.otcOnly || !product.rxRequired;
      const onlineMatch = this.isCategoryOnline(product.category);

      return queryMatch && categoryMatch && formMatch && dosageMatch && priceMatch && stockMatch && deliveryMatch && otcMatch && onlineMatch;
    });

    const sorters = {
      best: (a, b) => b.popularity - a.popularity || a.price - b.price,
      price: (a, b) => a.price - b.price,
      near: (a, b) => b.pharmacies - a.pharmacies,
      fast: (a, b) => a.deliveryMinutes - b.deliveryMinutes,
    };

    products = products.sort(sorters[filters.sort] || sorters.best);
    return products;
  }

  facet(field) {
    const counts = new Map();
    this.products.filter((product) => this.isCategoryOnline(product.category)).forEach((product) => {
      const value = product[field];
      if (!value) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
      .map(([value, count]) => ({ value, count }));
  }
}

class Ui {
  static icon(name) {
    const icons = {
      search: '<circle cx="11" cy="11" r="7"></circle><path d="m16 16 5 5"></path>',
      "arrow-right": '<path d="M5 12h14"></path><path d="m13 5 7 7-7 7"></path>',
      "arrow-left": '<path d="M19 12H5"></path><path d="m11 5-7 7 7 7"></path>',
      check: '<path d="M5 12l4 4 10-10"></path>',
      plus: '<path d="M12 5v14M5 12h14"></path>',
      minus: '<path d="M5 12h14"></path>',
      "chevron-right": '<path d="m9 18 6-6-6-6"></path>',
      "chevron-left": '<path d="m15 18-6-6 6-6"></path>',
      "chevron-down": '<path d="m6 9 6 6 6-6"></path>',
      "chevron-up": '<path d="m18 15-6-6-6 6"></path>',
      x: '<path d="M18 6 6 18M6 6l12 12"></path>',
      lock: '<path d="M6 10h12v11H6z"></path><path d="M8 10V7a4 4 0 0 1 8 0v3"></path>',
      "log-out": '<path d="M10 17l5-5-5-5"></path><path d="M15 12H3"></path><path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"></path>',
      "user-plus": '<circle cx="10" cy="8" r="4"></circle><path d="M2 22a8 8 0 0 1 16 0M19 8v6M16 11h6"></path>',
      calendar: '<path d="M8 2v4M16 2v4M3 10h18"></path><path d="M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2z"></path>',
      "calendar-check": '<path d="M8 2v4M16 2v4M3 10h18"></path><path d="M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2z"></path><path d="m8 15 2 2 5-5"></path>',
      "map-pin": '<path d="M12 21s7-5.2 7-11a7 7 0 0 0-14 0c0 5.8 7 11 7 11z"></path><circle cx="12" cy="10" r="2"></circle>',
      map: '<path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3z"></path><path d="M9 3v15M15 6v15"></path>',
      truck: '<path d="M3 7h11v10H3z"></path><path d="M14 10h4l3 3v4h-7z"></path><circle cx="7" cy="18" r="2"></circle><circle cx="18" cy="18" r="2"></circle>',
      bike: '<circle cx="6" cy="17" r="3"></circle><circle cx="18" cy="17" r="3"></circle><path d="M8 17l4-8 3 8M12 9h4"></path>',
      "shopping-cart": '<circle cx="9" cy="20" r="1"></circle><circle cx="18" cy="20" r="1"></circle><path d="M3 4h3l3 12h10l2-8H8"></path>',
      "shopping-bag": '<path d="M6 8h12l-1 13H7z"></path><path d="M9 8a3 3 0 0 1 6 0"></path>',
      "briefcase-business": '<path d="M4 7h16v13H4z"></path><path d="M9 7V4h6v3"></path><path d="M4 12h16"></path>',
      hospital: '<path d="M4 21V5l8-3 8 3v16"></path><path d="M9 11h6M12 8v6"></path>',
      store: '<path d="M4 10h16l-1-5H5z"></path><path d="M5 10v10h14V10"></path><path d="M9 20v-6h6v6"></path><path d="M4 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"></path>',
      cross: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"></path>',
      pill: '<path d="M10 21 3 14a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7z"></path><path d="m8 8 8 8"></path>',
      leaf: '<path d="M5 19c10 0 14-8 14-14C9 5 5 9 5 19z"></path><path d="M5 19c3-5 7-8 14-14"></path>',
      shield: '<path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10z"></path>',
      "shield-check": '<path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10z"></path><path d="m9 12 2 2 5-5"></path>',
      sparkles: '<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"></path>',
      baby: '<circle cx="12" cy="10" r="5"></circle><path d="M8 21h8M9 14l-3 3M15 14l3 3"></path>',
      "briefcase-medical": '<path d="M4 7h16v13H4z"></path><path d="M9 7V4h6v3"></path><path d="M12 10v6M9 13h6"></path>',
      "layout-grid": '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"></path>',
      list: '<path d="M8 6h13M8 12h13M8 18h13"></path><path d="M3 6h.01M3 12h.01M3 18h.01"></path>',
      star: '<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"></path>',
      heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"></path>',
      "badge-check": '<path d="M12 3l3 2 4 .5.5 4 2.5 3-2.5 3-.5 4-4 .5-3 2-3-2-4-.5-.5-4-2.5-3 2.5-3 .5-4 4-.5z"></path><path d="m8 12 3 3 6-6"></path>',
      package: '<path d="M4 8l8-4 8 4v9l-8 4-8-4z"></path><path d="M12 12 4 8M12 12l8-4M12 12v9"></path>',
      "package-check": '<path d="M4 8l8-4 8 4v9l-8 4-8-4z"></path><path d="m9 14 2 2 5-5"></path>',
      "package-search": '<path d="M4 8l8-4 8 4v9l-8 4-8-4z"></path><path d="M12 12 4 8M12 12l8-4"></path><circle cx="16" cy="16" r="3"></circle><path d="m18.2 18.2 2.3 2.3"></path>',
      "file-text": '<path d="M6 3h9l5 5v13H6z"></path><path d="M14 3v6h6M9 13h6M9 17h6"></path>',
      "file-down": '<path d="M6 3h9l5 5v13H6z"></path><path d="M14 3v6h6"></path><path d="M12 11v7"></path><path d="m9 15 3 3 3-3"></path>',
      tablets: '<path d="M7 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"></path><path d="M17 20a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"></path>',
      syringe: '<path d="m18 2 4 4M17 7l-9 9-4 1 1-4 9-9M12 6l6 6"></path>',
      thermometer: '<path d="M14 14.8V5a4 4 0 0 0-8 0v9.8a6 6 0 1 0 8 0z"></path>',
      "flask-conical": '<path d="M10 2v6L4 20h16L14 8V2"></path><path d="M8 2h8"></path>',
      scale: '<path d="M12 3v18M5 7h14M5 7l-3 6h6zM19 7l-3 6h6z"></path>',
      box: '<path d="M4 7l8-4 8 4v10l-8 4-8-4z"></path>',
      archive: '<path d="M4 7h16v14H4z"></path><path d="M2 3h20v4H2zM9 12h6"></path>',
      "receipt-text": '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"></path><path d="M9 7h6M9 11h6M9 15h4"></path>',
      "refresh-cw": '<path d="M21 12a9 9 0 0 1-15 6l-2-2"></path><path d="M3 12a9 9 0 0 1 15-6l2 2"></path><path d="M3 18v-6h6M21 6v6h-6"></path>',
      download: '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>',
      "message-circle": '<path d="M21 12a8 8 0 0 1-12 7l-5 1 1-5A8 8 0 1 1 21 12z"></path>',
      phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19 19 0 0 1-8.3-3 18.7 18.7 0 0 1-5.7-5.7 19 19 0 0 1-3-8.3A2 2 0 0 1 4.9 2h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.8L8.8 9.6a16 16 0 0 0 5.6 5.6l1.1-1.1a2 2 0 0 1 1.8-.6l3 .5a2 2 0 0 1 1.7 2z"></path>',
      "credit-card": '<path d="M3 5h18v14H3z"></path><path d="M3 10h18"></path>',
      "clipboard-list": '<path d="M8 4h8v4H8z"></path><path d="M6 6H4v18h16V6h-2"></path><path d="M8 13h8M8 17h8"></path>',
      "clipboard-check": '<path d="M8 4h8v4H8z"></path><path d="M6 6H4v18h16V6h-2"></path><path d="m8 15 2 2 5-5"></path>',
      "file-spreadsheet": '<path d="M6 3h9l5 5v13H6z"></path><path d="M9 13h8M9 17h8M13 9v12"></path>',
      "triangle-alert": '<path d="M12 3 2 21h20z"></path><path d="M12 9v5M12 17h.01"></path>',
      "circle-x": '<circle cx="12" cy="12" r="9"></circle><path d="m9 9 6 6M15 9l-6 6"></path>',
      "circle-check": '<circle cx="12" cy="12" r="9"></circle><path d="m8 12 3 3 5-6"></path>',
      "layout-dashboard": '<path d="M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z"></path>',
      tag: '<path d="M3 12V4h8l10 10-8 8z"></path><circle cx="8" cy="8" r="1"></circle>',
      "ticket-percent": '<path d="M3 8V5h18v3a3 3 0 0 0 0 6v3H3v-3a3 3 0 0 0 0-6z"></path><path d="m9 15 6-6M9 9h.01M15 15h.01"></path>',
      "chart-no-axes-column": '<path d="M5 20V10M12 20V4M19 20v-7"></path>',
      "circle-help": '<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a3 3 0 0 1 5 2c0 2-2.5 2-2.5 4M12 18h.01"></path>',
      settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2 3-.2-.1a1.8 1.8 0 0 0-2 .4l-.1.1-3.5-1.4v-.2a1.8 1.8 0 0 0-1.7-1.3h-.2L8.8 14l.1-.1a1.8 1.8 0 0 0 0-2.2l-.1-.1L10.2 8h.2a1.8 1.8 0 0 0 1.7-1.3v-.2L15.6 5l.1.1a1.8 1.8 0 0 0 2 .4l.2-.1 2 3-.1.1a1.8 1.8 0 0 0-.4 2"></path>',
      bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path>',
      "banknote": '<path d="M3 6h18v12H3z"></path><circle cx="12" cy="12" r="3"></circle>',
      clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
      flame: '<path d="M12 22a7 7 0 0 0 7-7c0-5-4-7-5-12-4 3-8 7-8 12a6 6 0 0 0 6 7z"></path>',
      "plus-square": '<path d="M4 4h16v16H4z"></path><path d="M12 8v8M8 12h8"></path>',
      pencil: '<path d="M4 20h4l12-12-4-4L4 16z"></path>',
      "sliders-horizontal": '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"></path><circle cx="16" cy="7" r="2"></circle><circle cx="8" cy="17" r="2"></circle>',
      shapes: '<path d="M8 3h8v8H8z"></path><circle cx="7" cy="17" r="4"></circle><path d="M17 13l5 8H12z"></path>',
      percent: '<path d="M19 5 5 19"></path><circle cx="7" cy="7" r="2"></circle><circle cx="17" cy="17" r="2"></circle>',
      upload: '<path d="M12 15V3"></path><path d="m7 8 5-5 5 5"></path><path d="M5 21h14"></path>',
      database: '<ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"></path><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"></path>',
      "external-link": '<path d="M14 4h6v6M20 4l-9 9"></path><path d="M18 13v7H4V6h7"></path>',
      info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v6M12 7h.01"></path>',
      factory: '<path d="M3 21V9l6 3V9l6 3V4h6v17z"></path><path d="M7 17h.01M11 17h.01M15 17h.01"></path>',
      "file-check": '<path d="M6 3h9l5 5v13H6z"></path><path d="M14 3v6h6"></path><path d="m9 15 2 2 5-5"></path>',
      hash: '<path d="M5 9h14M4 15h14M10 3 8 21M16 3l-2 18"></path>',
      activity: '<path d="M3 12h4l2-7 4 14 2-7h6"></path>',
      eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle>',
      "eye-off": '<path d="m3 3 18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.9 4.2A10.7 10.7 0 0 1 12 4c6 0 10 8 10 8a16 16 0 0 1-2.1 3.1M6.6 6.6C3.8 8.4 2 12 2 12s4 8 10 8a10 10 0 0 0 5.4-1.6"></path>',
      "trash-2": '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"></path>',
      "rotate-ccw": '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path>',
      "more-vertical": '<circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle>',
      send: '<path d="m22 2-7 20-4-9-9-4z"></path><path d="M22 2 11 13"></path>',
      paperclip: '<path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"></path>',
      "circle-alert": '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16h.01"></path>',
      "undo-2": '<path d="M9 14 4 9l5-5"></path><path d="M4 9h10a6 6 0 0 1 0 12h-1"></path>',
      "shield-alert": '<path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10z"></path><path d="M12 8v5M12 16h.01"></path>',
      ban: '<circle cx="12" cy="12" r="9"></circle><path d="M6 6l12 12"></path>',
      "badge-alert": '<path d="M12 3l3 2 4 .5.5 4 2.5 3-2.5 3-.5 4-4 .5-3 2-3-2-4-.5-.5-4-2.5-3 2.5-3 .5-4 4-.5z"></path><path d="M12 8v5M12 16h.01"></path>',
      coins: '<circle cx="8" cy="8" r="5"></circle><path d="M13 9a5 5 0 1 1-4 8"></path>',
      "messages-square": '<path d="M4 5h12v9H7l-3 3z"></path><path d="M9 18h8l3 3V9"></path>',
      navigation: '<path d="M3 11 22 2l-9 19-2-8z"></path>',
      route: '<circle cx="6" cy="19" r="2"></circle><circle cx="18" cy="5" r="2"></circle><path d="M8 19h4a4 4 0 0 0 4-4V9"></path>',
      car: '<path d="M5 17h14l-1-6-2-4H8l-2 4z"></path><circle cx="8" cy="17" r="2"></circle><circle cx="16" cy="17" r="2"></circle><path d="M3 12h18"></path>',
      save: '<path d="M5 3h12l3 3v15H5z"></path><path d="M8 3v6h8V3M8 21v-7h8v7"></path>',
      mail: '<path d="M3 5h18v14H3z"></path><path d="m3 7 9 6 9-6"></path>',
      camera: '<path d="M5 7h4l2-3h2l2 3h4v14H5z"></path><circle cx="12" cy="14" r="4"></circle>',
      images: '<rect x="3" y="5" width="16" height="14" rx="2"></rect><path d="m3 16 4-4 3 3 3-3 6 6"></path><path d="M8 9h.01"></path><path d="M21 8v10a3 3 0 0 1-3 3H8"></path>',
      "image-off": '<path d="M3 5h14a2 2 0 0 1 2 2v10"></path><path d="M21 21 3 3"></path><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7"></path><path d="m3 16 4-4 3 3"></path><path d="M8 9h.01"></path>',
      "check-circle": '<circle cx="12" cy="12" r="9"></circle><path d="m8 12 3 3 5-6"></path>',
      scan: '<path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3"></path><path d="M7 12h10"></path>',
      headphones: '<path d="M4 14a8 8 0 0 1 16 0"></path><path d="M4 14v5h4v-5H4zM16 14v5h4v-5h-4z"></path><path d="M16 19c0 2-2 3-4 3"></path>',
      signal: '<path d="M3 20h2M8 20h2v-6H8zM13 20h2V10h-2zM18 20h2V6h-2z"></path>',
      wifi: '<path d="M5 10a10 10 0 0 1 14 0M8 14a6 6 0 0 1 8 0M12 18h.01"></path>',
      battery: '<path d="M3 8h17v8H3z"></path><path d="M22 11v2"></path>',
      menu: '<path d="M4 6h16M4 12h16M4 18h16"></path>',
      user: '<circle cx="12" cy="8" r="4"></circle><path d="M4 22a8 8 0 0 1 16 0"></path>',
      wallet: '<path d="M4 7h17v14H4z"></path><path d="M16 12h5v4h-5z"></path>',
    };

    return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.check}</svg>`;
  }

  static brand() {
    return `
      <a class="brand" href="#home" aria-label="DoriGo">
        <span class="brand-symbol" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
        </span>
        <span class="brand-word">Dori<em>Go</em></span>
      </a>
    `;
  }

  static mapSurface(options = {}) {
    const latitude = Number.isFinite(Number(options.latitude)) ? Number(options.latitude) : 41.3111;
    const longitude = Number.isFinite(Number(options.longitude)) ? Number(options.longitude) : 69.2797;
    const zoom = Math.min(19, Math.max(10, Math.round(Number(options.zoom) || 14)));
    const markers = Array.isArray(options.markers) ? options.markers : [];
    const surfaceAttrs = options.surfaceAttrs || "";
    const googleApiKey = typeof window !== "undefined" ? String(window.DORIGO_GOOGLE_MAPS_API_KEY || "").trim() : "";
    const embedUrl = options.embedUrl || (googleApiKey
      ? `https://www.google.com/maps/embed/v1/view?key=${encodeURIComponent(googleApiKey)}&center=${encodeURIComponent(`${latitude},${longitude}`)}&zoom=${zoom}`
      : `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}&z=${zoom}&output=embed`);
    const markerMarkup = markers
      .filter((marker) => Number.isFinite(Number(marker.latitude)) && Number.isFinite(Number(marker.longitude)))
      .map((marker) => {
        const type = Format.escape(marker.type || "pin");
        const label = Format.escape(marker.label || "Точка на карте");
        const icon = marker.icon || (marker.type === "pharmacy" ? "hospital" : "map-pin");
        const markerAttrs = marker.attrs || "";
        return `
          <span
            class="dorigo-map-marker ${type} ${marker.active ? "active" : ""}"
            data-map-marker
            data-latitude="${Number(marker.latitude)}"
            data-longitude="${Number(marker.longitude)}"
            title="${label}"
            aria-label="${label}"
            ${markerAttrs}
          >
            ${Ui.icon(icon)}
          </span>
        `;
      })
      .join("");

    return `
      <div
        class="dorigo-map ${options.className || ""} ${options.interactive ? "is-interactive" : ""}"
        data-map-surface
        data-map-latitude="${latitude}"
        data-map-longitude="${longitude}"
        data-map-zoom="${zoom}"
        data-map-route="${options.route ? "true" : "false"}"
        role="${options.interactive ? "application" : "img"}"
        aria-label="${Format.escape(options.label || "Карта")}"
        ${options.interactive ? 'tabindex="0"' : ""}
        ${surfaceAttrs}
      >
        <iframe class="dorigo-map-embed" src="${Format.escape(embedUrl)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${Format.escape(options.label || "Google Maps")}"></iframe>
        <div class="dorigo-map-tiles" data-map-tiles aria-hidden="true"></div>
        <svg class="dorigo-map-route-line" data-map-route-line aria-hidden="true"></svg>
        ${markerMarkup}
        ${options.hint ? `<span class="dorigo-map-hint">${options.hint}</span>` : ""}
        <span class="dorigo-map-attribution">Google Maps</span>
      </div>
    `;
  }

  static productImages(product) {
    const allowedImageSource = (value) => {
      const source = String(value || "").trim();
      return source.startsWith("data:image/")
        || source.startsWith("assets/")
        || source.startsWith("./assets/")
        || /^https?:\/\//i.test(source);
    };
    const images = Array.isArray(product?.images)
      ? product.images
        .map((image, index) => typeof image === "string"
          ? { data: image, name: `Фото ${index + 1}` }
          : {
            ...image,
            data: image?.data || image?.src || "",
            name: image?.name || `Фото ${index + 1}`,
          })
        .filter((image) => allowedImageSource(image.data))
      : [];
    if (allowedImageSource(product?.imageData) && !images.some((image) => image.data === product.imageData)) {
      images.unshift({ data: product.imageData, name: product.photoName || "Фото упаковки" });
    }
    return images.slice(0, 6);
  }

  static packshot(product, size = "") {
    const images = this.productImages(product);
    if (images.length) {
      return `<div class="packshot has-photo ${product.color || "blue"} ${size}"><img src="${Format.escape(images[0].data)}" alt="${Format.escape(product.name)}" />${images.length > 1 ? `<span class="packshot-count">${Ui.icon("images")} ${images.length}</span>` : ""}</div>`;
    }
    return `<div class="packshot photo-pending ${product.color || "blue"} ${size}">${Ui.icon("image-off")}<span>Фото проверяется</span><small>${Format.escape(product.dosage || product.subtitle || "")}</small></div>`;
  }

  static publicHeader(user = null) {
    const userLabel = user ? Format.escape(user.name.split(" ")[0] || user.name) : "";
    const patientUnread = user?.type === "patient" && Array.isArray(user.notifications)
      ? user.notifications.filter((item) => !item.read).length
      : 0;
    return `
      <header class="public-header">
        <div class="container public-header-inner">
          ${Ui.brand()}
          <nav class="public-nav" aria-label="Главное меню">
            <a href="#search">Каталог</a>
            <a href="#order">Доставка</a>
            <a href="#partner">Для аптек</a>
          </nav>
          <div class="public-search">
            ${Ui.icon("search")}
            <input data-public-search type="search" value="" placeholder="Поиск по названию, действующему веществу..." />
          </div>
          <div class="button-row">
            ${user ? `
              ${user.type === "patient" ? `<a class="bell patient-header-bell" href="#account" data-count="${patientUnread}" aria-label="Уведомления пациента">${Ui.icon("bell")}</a>` : ""}
              <a class="btn ghost login-button" href="${user.type === "pharmacy" ? "#partner" : "#account"}">${Ui.icon("user")} ${userLabel}</a>
              <button class="btn primary" type="button" data-auth-logout>Выйти</button>
            ` : `
              <button class="btn ghost login-button" type="button" data-auth="login">Войти</button>
              <button class="btn primary" type="button" data-auth="register">Регистрация</button>
            `}
          </div>
        </div>
      </header>
    `;
  }

  static footer() {
    return `
      <footer class="footer">
        <div class="container">
          <div class="benefits">
            ${Ui.benefit("shield-check", "Проверенные аптеки", "Только лицензированные аптеки и оригинальные товары")}
            ${Ui.benefit("bike", "Быстрая доставка", "Доставка от 1 часа по Ташкенту")}
            ${Ui.benefit("tag", "Актуальные цены", "Реальные цены аптек без наценок")}
            ${Ui.benefit("headphones", "Поддержка 24/7", "Мы всегда на связи в Telegram и по телефону")}
          </div>
          <div class="footer-top">
            <div>
              ${Ui.brand()}
              <p>Сервис поиска лекарств и товаров для здоровья с доставкой из аптек Ташкента.</p>
              <div class="socials">
                <a class="telegram" href="https://t.me/DoriGo_support" target="_blank" rel="noopener" aria-label="DoriGo в Telegram">T</a>
                <a class="instagram" href="https://www.instagram.com/" target="_blank" rel="noopener" aria-label="DoriGo в Instagram">I</a>
                <a class="facebook" href="https://www.facebook.com/" target="_blank" rel="noopener" aria-label="DoriGo в Facebook">F</a>
              </div>
            </div>
            ${Ui.footerColumn("Покупателям", ["Каталог", "Аптеки", "Доставка", "Как сделать заказ", "Вопросы и ответы"])}
            ${Ui.footerColumn("Для аптек", ["Стать партнером", "Условия сотрудничества", "API для аптек", "Вход для партнеров"])}
            ${Ui.footerColumn("О компании", ["О нас", "Контакты", "Пользовательское соглашение", "Политика конфиденциальности"])}
            <div>
              <h4>Свяжитесь с нами</h4>
              <div class="contact-list">
                <a href="tel:+998712070707">${Ui.icon("phone")} +998 71 207-07-07</a>
                <a href="https://t.me/DoriGo_support" target="_blank" rel="noopener">${Ui.icon("send")} @DoriGo_support</a>
                <a href="mailto:support@dorigo.uz">${Ui.icon("message-circle")} support@dorigo.uz</a>
              </div>
            </div>
          </div>
          <div class="footer-bottom">
            <span>© ${new Date().getFullYear()} DoriGo. Все права защищены.</span>
            <span>Работаем по всему Ташкенту</span>
            <span>Способы оплаты: Click | payme</span>
          </div>
        </div>
      </footer>
    `;
  }

  static footerColumn(title, links) {
    return `<div><h4>${title}</h4><div class="footer-links">${links.map((link) => `<a href="${Format.escape(Ui.footerHref(link))}">${link}</a>`).join("")}</div></div>`;
  }

  static footerHref(label) {
    const routes = {
      Каталог: "#search",
      Аптеки: "#search",
      Доставка: "#order",
      "Как сделать заказ": "#search",
      "Вопросы и ответы": "#home",
      "Стать партнером": "#partner",
      "Стать партнёром": "#partner",
      "Условия сотрудничества": "#partner",
      "API для аптек": "#partner",
      "Вход для партнеров": "#partner",
      "Вход для партнёров": "#partner",
      "О нас": "#home",
      Контакты: "mailto:support@dorigo.uz",
      "Пользовательское соглашение": "#home",
      "Политика конфиденциальности": "#home",
    };
    return routes[label] || "#home";
  }

  static benefit(icon, title, text) {
    return `
      <div class="benefit">
        <span class="icon-tile">${Ui.icon(icon)}</span>
        <div><strong>${title}</strong><p class="muted">${text}</p></div>
      </div>
    `;
  }

  static productCard(product, mode = "grid", favorite = false) {
    const klass = mode === "list" ? "product-card list" : "product-card";
    const canBuy = Number(product.price) > 0 && Number(product.stock) > 0;
    const favoriteButton = `<button class="icon-button favorite-button ${favorite ? "active" : ""}" type="button" data-favorite-toggle="${Format.escape(product.id)}" aria-label="${favorite ? "Убрать из избранного" : "Добавить в избранное"}" title="${favorite ? "В избранном" : "Добавить в избранное"}">${Ui.icon("heart")}</button>`;
    const chips = [
      product.pharmacies ? `${product.pharmacies} аптек` : "пока без аптек",
      Number(product.stock) > 0 ? `${product.stock} шт.` : "нет предложений",
      product.sourceVerified ? "официальная карточка" : Ui.productImages(product).length ? "есть фото" : "",
    ].filter(Boolean);
    const chipMarkup = `<div class="product-proof-chips">${chips.map((chip) => `<span>${Format.escape(chip)}</span>`).join("")}</div>`;
    if (mode === "home" || mode === "related") {
      const related = mode === "related";
      const actionLabel = related ? "Подробнее" : canBuy ? "Выбрать аптеку" : "Подробнее";
      return `
        <article class="product-card home-product-card carousel-product-card ${related ? "related-product-card" : ""}">
          ${favoriteButton}
          ${Ui.packshot(product)}
          <div class="home-product-copy">
            <strong title="${Format.escape(product.name)}">${Format.escape(product.name)}</strong>
            <p>${Format.escape(product.subtitle || "")}</p>
          </div>
          <div class="price">${product.priceLabel}</div>
          ${chipMarkup}
          <p class="availability">${product.availabilityLabel}</p>
          <a class="btn small ghost" href="#product" data-product-select="${Format.escape(product.id)}">${actionLabel}</a>
        </article>
      `;
    }
    return `
      <article class="${klass}">
        ${favoriteButton}
        ${Ui.packshot(product)}
        <div>
          <strong>${product.name}</strong>
          <p>${product.subtitle}</p>
          <p class="product-meta">ID: ${product.id} · ${product.dosage || "дозировка уточняется"} · ${product.form || "форма уточняется"}</p>
          <p class="product-description">${product.description || ""}</p>
          <span class="badge ${Ui.statusClass(product.status)}">${product.status}</span>
          <div class="price">${product.priceLabel}</div>
          ${chipMarkup}
          <p>${product.availabilityLabel}</p>
          <a class="btn small ghost" href="#product" data-product-select="${Format.escape(product.id)}">${canBuy ? "Выбрать аптеку" : "Подробнее"}</a>
        </div>
      </article>
    `;
  }

  static statusClass(value) {
    if (["Новый", "Подтвержден", "В наличии", "Успешно", "Одобрено", "Онлайн", "Без рецепта", "Готов", "Готово", "Завершен", "Доставлен"].includes(value)) return "ok";
    if (["Подтвердить", "Мало", "На рассмотрении", "Рецептурный", "Собирается", "Нужен ответ", "С ошибками"].includes(value)) return "warn";
    if (["Нет", "Нет в наличии", "Отклонено", "Ошибка", "Запрещен", "Отменен"].includes(value)) return "danger";
    if (["Собран", "В пути", "Передан курьеру", "Готов к выдаче", "Доставляет"].includes(value)) return "blue";
    if (["Офлайн", "Скрыт"].includes(value)) return "muted";
    return "purple";
  }

  static authModal(mode, accountType = "patient") {
    if (!mode) return "";
    const isRegister = mode === "register";
    const isPharmacy = accountType === "pharmacy";
    return `
      <div class="modal-backdrop" data-close-auth>
        <section class="auth-modal ${isRegister ? "registration-modal" : ""}" role="dialog" aria-modal="true" aria-labelledby="auth-title">
          <button class="icon-button modal-close" type="button" aria-label="Закрыть" data-close-auth>${Ui.icon("x")}</button>
          <span class="geo-pill">${Ui.icon(isRegister ? "user-plus" : "lock")} ${isRegister ? "Новый аккаунт" : "Безопасный вход"}</span>
          <h2 id="auth-title">${isRegister ? "Регистрация в DoriGo" : "Войти в DoriGo"}</h2>
          <p class="muted">${isRegister ? "Создайте аккаунт пациента или зарегистрируйте аптеку. Подтверждение пока не требуется." : "Введите телефон или email и пароль, указанные при регистрации."}</p>
          ${isRegister ? `
            <div class="auth-type-switch">
              <button type="button" class="${!isPharmacy ? "active" : ""}" data-auth-type="patient">${Ui.icon("user")} Для пациента</button>
              <button type="button" class="${isPharmacy ? "active" : ""}" data-auth-type="pharmacy">${Ui.icon("hospital")} Для аптеки</button>
            </div>
          ` : ""}
          <form class="auth-form" data-auth-form="${mode}">
            ${isRegister ? `
              <input type="hidden" name="accountType" value="${accountType}" />
              <label>${isPharmacy ? "Имя владельца или управляющего" : "Имя и фамилия"}<input name="name" required placeholder="${isPharmacy ? "Александр Александров" : "Александр Иванов"}" /></label>
              ${isPharmacy ? `
                <div class="form-two">
                  <label>Название организации<input name="organization" required placeholder="ООО «Здоровье»" /></label>
                  <label>Название первой аптеки<input name="pharmacyName" required placeholder="Аптека №1" /></label>
                </div>
                <label>Адрес первой аптеки<input name="address" required placeholder="Ташкент, ул. Шахрисабз, 23" /></label>
                <label class="auth-network-check"><input name="isNetwork" type="checkbox" /> <span>Это сеть аптек. Остальные точки можно добавить после регистрации.</span></label>
              ` : `
                <label>Адрес доставки <span class="optional">(необязательно)</span><input name="address" placeholder="Ташкент, улица, дом, квартира" /></label>
              `}
            ` : ""}
            <label>Телефон или email<input name="contact" required autocomplete="username" placeholder="+998 90 123-45-67" /></label>
            <label>Пароль<input name="password" type="password" minlength="6" required autocomplete="${isRegister ? "new-password" : "current-password"}" placeholder="Минимум 6 символов" /></label>
            <button class="btn primary" type="submit">${isRegister ? "Зарегистрироваться" : "Войти"}</button>
            <button class="auth-mode-link" type="button" data-auth="${isRegister ? "login" : "register"}">${isRegister ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Создать"}</button>
          </form>
        </section>
      </div>
    `;
  }

  static productModal(isOpen, draft = {}, matches = [], categoryOptions = [], catalogProducts = [], pharmacyInventory = []) {
    if (!isOpen) return "";
    const value = (name) => Format.escape(draft[name] || "");
    const selectedProduct = catalogProducts.find((product) => product.id === draft.catalogId) || null;
    const existingOffer = selectedProduct
      ? pharmacyInventory.find((offer) => offer.catalogId === selectedProduct.id)
      : null;
    const catalogQuery = String(draft.catalogQuery || "").trim().toLowerCase();
    const matchingCatalog = catalogProducts.filter((product) => {
      if (!catalogQuery) return true;
      return [
        product.name,
        product.mnn,
        product.registrationNumber,
        product.manufacturer,
        product.dosage,
        product.form,
      ].some((field) => String(field || "").toLowerCase().includes(catalogQuery));
    });
    const visibleCatalog = matchingCatalog.slice(0, 100);
    if (selectedProduct && !visibleCatalog.some((product) => product.id === selectedProduct.id)) {
      visibleCatalog.unshift(selectedProduct);
    }
    const catalog = [...visibleCatalog].sort((a, b) => {
      const categoryCompare = String(a.category || "").localeCompare(String(b.category || ""), "ru");
      return categoryCompare
        || String(a.name || "").localeCompare(String(b.name || ""), "ru")
        || String(a.registrationNumber || "").localeCompare(String(b.registrationNumber || ""), "ru");
    });
    const catalogGroups = new Map();
    catalog.forEach((product) => {
      const category = product.category || "Прочее";
      if (!catalogGroups.has(category)) catalogGroups.set(category, []);
      catalogGroups.get(category).push(product);
    });
    const expiryValue = Format.expiryInput(draft.expiry);
    const today = new Date();
    const expiryMin = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

    return `
      <div class="modal-backdrop product-backdrop" data-close-product>
        <section class="auth-modal product-modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
          <button class="icon-button modal-close" type="button" aria-label="Закрыть" data-close-product>${Ui.icon("x")}</button>
          <div class="product-modal-head">
            <span class="geo-pill">${Ui.icon("badge-check")} Предложение аптеки</span>
            <h2 id="product-modal-title">Добавить препарат из каталога</h2>
            <p class="muted">Аптека не создаёт карточку препарата и не изменяет описание, состав, изображения или рецептурность. Выберите готовую карточку DoriGo и укажите только данные своего предложения.</p>
          </div>
          <form class="product-form" data-product-form>
            <div class="catalog-lookup">
              <div class="lookup-control catalog-search-control">
                <label class="product-field">
                  <span>Поиск по единому каталогу</span>
                  <input name="catalogQuery" data-catalog-query value="${value("catalogQuery")}" placeholder="Название, МНН или регистрационный номер" autocomplete="off" />
                </label>
                <button class="btn ghost" type="button" data-catalog-filter>${Ui.icon("search")} Найти</button>
              </div>
              <p class="lookup-hint">${matchingCatalog.length
                ? `Найдено ${matchingCatalog.length}. В списке показано не больше 100 карточек.`
                : "Совпадений в официальном каталоге не найдено."}</p>
              <label class="product-field">
                <span>Препарат из единого каталога *</span>
                <select name="catalogId" data-catalog-select required>
                  <option value="">${catalogQuery ? "Выберите найденный препарат" : "Введите запрос или выберите из первых карточек"}</option>
                  ${Array.from(catalogGroups, ([category, products]) => `
                    <optgroup label="${Format.escape(category)}">
                      ${products.map((product) => `<option value="${Format.escape(product.id)}" ${draft.catalogId === product.id ? "selected" : ""}>${Format.escape(product.name)} — ${Format.escape(product.subtitle || product.dosage || "")} — ${Format.escape(product.registrationNumber || "без номера")}</option>`).join("")}
                    </optgroup>
                  `).join("")}
                </select>
                <small>В списке должна быть только одна центральная карточка каждой зарегистрированной формы препарата.</small>
              </label>
              ${selectedProduct ? `
                <div class="catalog-selected-card">
                  ${Ui.packshot(selectedProduct)}
                  <div>
                    <span class="status ${existingOffer ? "blue" : selectedProduct.sourceVerified ? "ok" : "warn"}">${existingOffer ? "Уже подключен в аптеке" : selectedProduct.sourceVerified ? "Источник проверен" : "Ожидает официальных данных"}</span>
                    <h3>${Format.escape(selectedProduct.name)} ${Format.escape(selectedProduct.subtitle || "")}</h3>
                    <p>МНН: ${Format.escape(selectedProduct.mnn || selectedProduct.ingredient || "Не указано")}</p>
                    <p>${Format.escape(selectedProduct.manufacturer || "Производитель не указан")}${selectedProduct.country ? ` · ${Format.escape(selectedProduct.country)}` : ""}</p>
                    <p>${Format.escape(selectedProduct.prescriptionStatus || (selectedProduct.rxRequired ? "По рецепту" : "Без рецепта"))}${selectedProduct.registrationNumber ? ` · Рег. № ${Format.escape(selectedProduct.registrationNumber)}` : ""}</p>
                    ${existingOffer ? `<p class="muted">Текущие данные аптеки: ${Format.money(existingOffer.price)} · остаток ${existingOffer.stock} шт.${existingOffer.expiry ? ` · срок ${Format.escape(Format.expiryLabel(existingOffer.expiry))}` : ""}</p>` : ""}
                  </div>
                </div>
              ` : `<p class="lookup-hint">${Ui.icon("search")} Выберите зарегистрированный препарат. Создать новую карточку из кабинета аптеки нельзя.</p>`}
            </div>

            <div class="product-form-grid offer-only-fields">
              <label class="product-field"><span>Цена, сум *</span><input name="price" type="number" min="0" step="100" value="${value("price")}" required placeholder="6000" /></label>
              <label class="product-field"><span>Закупочная цена, сум</span><input name="purchasePrice" type="number" min="0" step="100" value="${value("purchasePrice")}" placeholder="4200" /></label>
              <label class="product-field"><span>Остаток, шт. *</span><input name="stock" type="number" min="0" step="1" value="${value("stock")}" required placeholder="12" /></label>
              <label class="product-field"><span>Штрихкод партии</span><input name="barcode" value="${value("barcode")}" inputmode="numeric" placeholder="478001..." /></label>
              <label class="product-field"><span>Срок годности *</span><input name="expiry" type="month" min="${expiryMin}" value="${expiryValue}" required /><small>Выберите месяц и год во встроенном календаре.</small></label>
            </div>
            <div class="catalog-lock-note">${Ui.icon("shield-check")} Медицинская карточка и фотографии централизованно обновляются администратором DoriGo из официальных источников.</div>
            <div class="product-form-actions">
              <button class="btn ghost" type="button" data-close-product>Отмена</button>
              <button class="btn primary" type="submit" ${selectedProduct ? "" : "disabled"}>${Ui.icon("check-circle")} ${existingOffer ? "Обновить предложение" : "Добавить предложение"}</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }

  static importSummaryModal(summary) {
    if (!summary) return "";
    const hasIssues = Number(summary.errors) > 0;
    return `
      <div class="modal-backdrop" data-close-import>
        <section class="auth-modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <button class="icon-button modal-close" type="button" aria-label="Закрыть" data-close-import>${Ui.icon("x")}</button>
          <span class="geo-pill">${Ui.icon(hasIssues ? "triangle-alert" : "file-spreadsheet")} ${hasIssues ? "Импорт завершен с замечаниями" : "Импорт завершен"}</span>
          <h2 id="import-title">Результат загрузки Excel</h2>
          <p class="muted">${summary.fileName ? `Файл: ${Format.escape(summary.fileName)}. ` : ""}Опубликованы только строки, которые точно совпали с единым каталогом DoriGo.</p>
          <div class="import-summary-grid">
            <article><strong>${summary.uploaded}</strong><span>Загружено</span></article>
            <article><strong>${summary.recognized || 0}</strong><span>Распознано</span></article>
            <article><strong>${summary.updated}</strong><span>Обновлено</span></article>
            <article><strong>${summary.added}</strong><span>Добавлено предложений</span></article>
            <article class="${summary.unmatched ? "has-warning" : ""}"><strong>${summary.unmatched || 0}</strong><span>Не найдено</span></article>
            <article class="${summary.duplicates ? "has-warning" : ""}"><strong>${summary.duplicates || 0}</strong><span>Дубликаты</span></article>
            <article class="${summary.expiryErrors ? "has-error" : ""}"><strong>${summary.expiryErrors || 0}</strong><span>Срок годности</span></article>
            <article class="${summary.invalid ? "has-error" : ""}"><strong>${summary.invalid || 0}</strong><span>Ошибки формата</span></article>
          </div>
          ${summary.details.length ? `<div class="import-errors"><strong>Строки, требующие проверки</strong>${summary.details.slice(0, 12).map((detail) => `<p>${Format.escape(detail)}</p>`).join("")}${summary.details.length > 12 ? `<p>И ещё ${summary.details.length - 12} строк. Исправьте файл и загрузите повторно.</p>` : ""}</div>` : `<div class="import-ok">${Ui.icon("check-circle")} Все строки распознаны и опубликованы на витрине.</div>`}
          <div class="import-actions">
            <button class="btn ghost" type="button" data-excel-template>${Ui.icon("download")} Скачать шаблон</button>
            <button class="btn ghost" type="button" data-catalog-reference>${Ui.icon("database")} Справочник ID</button>
            <button class="btn ghost" type="button" data-inventory-export>${Ui.icon("file-down")} Скачать текущий прайс</button>
            ${summary.problemRows?.length ? `<button class="btn ghost" type="button" data-excel-error-report>${Ui.icon("file-down")} Скачать отчёт ошибок</button>` : ""}
            <button class="btn ghost" type="button" data-excel-upload>${Ui.icon("upload")} Загрузить исправленный файл</button>
            <button class="btn primary" type="button" data-close-import>Готово</button>
          </div>
        </section>
      </div>
    `;
  }

  static orderScanModal(order) {
    if (!order) return "";
    const items = Array.isArray(order.items) ? order.items : [];
    const rows = items.length
      ? items.map((item, index) => `
        <div class="scan-item-row ${item.collected ? "collected" : ""}">
          ${Ui.packshot(item, "small")}
          <div>
            <strong>${Format.escape(item.name || "Позиция заказа")}</strong>
            <small>${Format.escape(item.subtitle || item.category || "")}</small>
            <code>${Format.escape(item.barcode || item.productId || item.offerId || "без кода")}</code>
          </div>
          <span class="status ${item.collected ? "ok" : "warn"}">${item.collected ? "Собрано" : "Ожидает"}</span>
        </div>
      `).join("")
      : `<div class="panel-empty">${Ui.icon("scan")}<strong>В заказе нет позиций</strong></div>`;
    const collected = items.filter((item) => item.collected).length;
    return `
      <div class="modal-backdrop" data-close-order-scan>
        <section class="auth-modal order-scan-modal" role="dialog" aria-modal="true" aria-labelledby="order-scan-title">
          <button class="icon-button modal-close" type="button" aria-label="Закрыть" data-close-order-scan>${Ui.icon("x")}</button>
          <span class="geo-pill">${Ui.icon("scan")} Сборка заказа</span>
          <h2 id="order-scan-title">Сканирование #${Format.escape(order.id || "")}</h2>
          <p class="muted">Собрано ${collected} из ${items.length} позиций.</p>
          <form class="scan-form" data-order-scan-form>
            <input type="hidden" name="orderId" value="${Format.escape(order.id || "")}" />
            <label class="product-field">
              <span>Штрихкод или ID DoriGo</span>
              <input name="code" autocomplete="off" inputmode="text" autofocus placeholder="478... или ID товара" />
            </label>
            <button class="btn primary" type="submit">${Ui.icon("check-circle")} Отметить собранным</button>
          </form>
          <div class="scan-items">${rows}</div>
        </section>
      </div>
    `;
  }

  static locationPickerModal(picker, mapUrl) {
    if (!picker) return "";
    const isPharmacy = picker.mode === "pharmacy";
    const latitude = Number(picker.latitude);
    const longitude = Number(picker.longitude);
    const centerLatitude = Number.isFinite(Number(picker.centerLatitude)) ? Number(picker.centerLatitude) : latitude;
    const centerLongitude = Number.isFinite(Number(picker.centerLongitude)) ? Number(picker.centerLongitude) : longitude;
    const zoom = Number(picker.zoom) || 15;
    const googleUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
    return `
      <div class="modal-backdrop location-picker-backdrop" data-close-location-picker>
        <section class="auth-modal location-picker-modal" role="dialog" aria-modal="true" aria-labelledby="location-picker-title">
          <button class="icon-button modal-close" type="button" aria-label="Закрыть" data-close-location-picker>${Ui.icon("x")}</button>
          <div class="location-picker-head">
            <span class="geo-pill">${Ui.icon(isPharmacy ? "hospital" : "map-pin")} ${isPharmacy ? "Точка аптеки" : "Точка доставки"}</span>
            <h2 id="location-picker-title">${isPharmacy ? "Укажите аптеку на карте" : "Куда доставить заказ?"}</h2>
            <p class="muted">Нажмите на карту или перетащите маркер. Сохранённая точка используется для расстояний, зоны доставки и маршрута курьера.</p>
          </div>
          <form class="location-picker-form" data-location-picker-form>
            <div class="location-picker-map">
              <div class="location-center-pin">${Ui.icon(isPharmacy ? "hospital" : "map-pin")}</div>
              ${Ui.mapSurface({
                latitude: centerLatitude,
                longitude: centerLongitude,
                zoom,
                className: "location-picker-surface",
                interactive: true,
                label: "Карта выбора местоположения. Перетаскивайте карту, нажмите на нужное место или перетащите маркер.",
                surfaceAttrs: `data-location-pick-surface data-latitude="${centerLatitude}" data-longitude="${centerLongitude}" data-zoom="${zoom}" title="Перетащите карту, нажмите на нужное место или двигайте маркер"`,
                markers: [{
                  latitude,
                  longitude,
                  type: isPharmacy ? "pharmacy" : "client",
                  icon: isPharmacy ? "hospital" : "map-pin",
                  label: isPharmacy ? "Точка аптеки" : "Точка доставки",
                  active: true,
                  attrs: 'data-location-marker role="button" tabindex="0"',
                }],
                hint: `${Ui.icon("navigation")} Перетаскивайте карту или нажмите на нужное место`,
              })}
              <div class="location-picker-controls">
                <button class="icon-button" type="button" data-location-zoom="-1" title="Отдалить">−</button>
                <strong>${zoom}x</strong>
                <button class="icon-button" type="button" data-location-zoom="1" title="Приблизить">+</button>
                <button class="btn ghost" type="button" data-location-center>${Ui.icon("cross")} Центр Ташкента</button>
                <a class="btn ghost" href="${Format.escape(googleUrl)}" target="_blank" rel="noopener">${Ui.icon("navigation")} Открыть Google Maps</a>
              </div>
            </div>
            <div class="location-picker-fields">
              <label class="settings-input location-address-field">
                <span>${isPharmacy ? "Адрес аптеки" : "Адрес доставки"}</span>
                <span class="location-address-control">
                  <input name="address" value="${Format.escape(picker.address || "")}" placeholder="Ташкент, улица, дом, квартира" autocomplete="street-address" />
                  <button class="icon-button" type="button" data-location-search title="Найти адрес на карте">${Ui.icon("search")}</button>
                </span>
              </label>
              <div class="location-search-status" data-location-status data-tone="${Format.escape(picker.statusTone || "")}" aria-live="polite">${Format.escape(picker.status || "Перетащите карту, чтобы выбрать точное место.")}</div>
              
              <div class="location-action-stack">
                <button class="btn ghost location-current-button" type="button" data-location-current>${Ui.icon("navigation")} Моё текущее местоположение</button>
              </div>

              <div style="display:none">
                <input name="latitude" type="hidden" value="${latitude.toFixed(6)}" />
                <input name="longitude" type="hidden" value="${longitude.toFixed(6)}" />
              </div>
              <div class="location-coordinate-note">
                <span class="icon-tile">${Ui.icon("map-pin")}</span>
                <span><small>Выбранные координаты</small><strong data-location-coordinate>${latitude.toFixed(6)}, ${longitude.toFixed(6)}</strong></span>
              </div>
              <small class="location-geocoder-note">Поиск адресов использует данные OpenStreetMap; карта и маршруты открываются в Google Maps.</small>
            </div>
              <div class="location-picker-actions">
                <button class="btn primary full-width" type="submit">${Ui.icon("check-circle")} Подтвердить адрес</button>
              </div>          </form>
        </section>
      </div>
    `;
  }

  static orderChat(order, mode = "patient") {
    const messages = Array.isArray(order?.messages) ? order.messages : [];
    const isPharmacy = mode === "pharmacy";
    const title = isPharmacy ? "Чат с клиентом" : "Чат с аптекой";
    const subtitle = isPharmacy
      ? "Сообщения сохраняются в заказе и видны пациенту."
      : "Уточните наличие, замену или детали доставки прямо в заказе.";
    const placeholder = isPharmacy ? "Напишите клиенту..." : "Напишите аптеке...";
    const rows = messages.length
      ? messages.map((message) => {
        const mine = isPharmacy ? message.author === "pharmacy" : message.author === "patient";
        const author = message.author === "pharmacy" ? "Аптека" : message.author === "patient" ? "Пациент" : "DoriGo";
        return `<div class="order-chat-message ${mine ? "mine" : "theirs"}"><div><strong>${Format.escape(message.name || author)}</strong><small>${Format.escape(Format.dateTime(message.createdAt || new Date()))}</small></div><p>${Format.escape(message.text || "")}</p></div>`;
      }).join("")
      : `<div class="order-chat-empty"><span class="icon-tile">${Ui.icon("message-circle")}</span><strong>Сообщений пока нет</strong><p class="muted">${isPharmacy ? "Если клиент задаст вопрос, он появится здесь." : "Напишите аптеке, если нужно уточнить заказ."}</p></div>`;
    return `
      <form class="panel order-chat-card ${isPharmacy ? "pharmacy" : "patient"}" data-order-chat-form>
        <input type="hidden" name="orderId" value="${Format.escape(order?.id || "")}" />
        <div class="panel-head slim">
          <div><h3>${title}</h3><p class="muted">${subtitle}</p></div>
          <span class="status ${messages.length ? "blue" : "ok"}">${messages.length}</span>
        </div>
        <div class="order-chat-list">${rows}</div>
        <div class="order-chat-compose">
          <textarea name="message" maxlength="600" required placeholder="${placeholder}"></textarea>
          <button class="btn primary" type="submit">${Ui.icon("send")} Отправить</button>
        </div>
      </form>
    `;
  }

  static orderHistory(order, mode = "patient") {
    const rawEntries = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
    const entries = rawEntries.length ? rawEntries : [{
      id: `hist-${order?.id || "order"}-created-fallback`,
      icon: "shopping-bag",
      title: "Заказ создан",
      details: `${order?.client || "Пациент"} оформил заказ.`,
      status: order?.status || "",
      actor: order?.client || "Пациент",
      createdAt: order?.createdAt || new Date().toISOString(),
    }];
    const rows = entries
      .slice()
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
      .slice(0, mode === "pharmacy" ? 10 : 8)
      .map((entry) => {
        const date = entry.createdAt ? Format.dateTime(entry.createdAt) : "Сейчас";
        return `
          <div class="order-history-item">
            <span class="icon-tile">${Ui.icon(entry.icon || "clock")}</span>
            <div>
              <div class="order-history-top">
                <strong>${Format.escape(entry.title || "Событие заказа")}</strong>
                <small>${Format.escape(date)}</small>
              </div>
              ${entry.details ? `<p>${Format.escape(entry.details)}</p>` : ""}
              <div class="order-history-meta">
                ${entry.actor ? `<span>${Format.escape(entry.actor)}</span>` : ""}
                ${entry.status ? `<span class="status ${Ui.statusClass(entry.status)}">${Format.escape(entry.status)}</span>` : ""}
              </div>
            </div>
          </div>
        `;
      }).join("");
    return `
      <section class="panel order-history-card">
        <div class="panel-head slim">
          <div><h3>История заказа</h3><p class="muted">Все важные действия сохраняются автоматически.</p></div>
          <span class="status blue">${entries.length}</span>
        </div>
        <div class="order-history-list">${rows}</div>
      </section>
    `;
  }

  static toast(text) {
    return text ? `<div class="toast">${Ui.icon("check-circle")} ${text}</div>` : "";
  }
}

class PublicViews {
  constructor(store) {
    this.store = store;
  }

  accessGate(user = null, target = "partner", returnRoute = target) {
    const isPartner = target === "partner";
    const wrongRole = Boolean(user && ((isPartner && user.type !== "pharmacy") || (!isPartner && user.type !== "patient")));
    const title = isPartner ? "Кабинет аптеки" : "Личный кабинет пациента";
    const description = wrongRole
      ? isPartner
        ? "Вы вошли как пациент. Для управления товарами, заказами и филиалами нужен отдельный аккаунт аптеки."
        : "Этот профиль принадлежит аптеке. Данные организации и филиалов находятся в кабинете партнёра."
      : isPartner
        ? "Войдите как владелец или управляющий аптекой. Если аккаунта ещё нет, зарегистрируйте одну аптеку или целую сеть."
        : "Войдите, чтобы сохранять адрес доставки и управлять личными данными.";
    return `
      <div class="page">
        ${Ui.publicHeader(user)}
        <main class="container access-page">
          <section class="access-card panel">
            <span class="access-icon">${Ui.icon(isPartner ? "hospital" : "user")}</span>
            <span class="geo-pill">${Ui.icon("lock")} Защищённый раздел</span>
            <h1>${title}</h1>
            <p class="lead">${description}</p>
            <div class="button-row access-actions">
              ${wrongRole ? `
                <a class="btn primary" href="${user.type === "pharmacy" ? "#partner" : "#account"}">Перейти в свой кабинет</a>
                <button class="btn ghost" type="button" data-auth-logout>Выйти из аккаунта</button>
              ` : `
                <button class="btn primary" type="button" data-auth="login" data-auth-target="${returnRoute}">${Ui.icon("lock")} Войти</button>
                <button class="btn ghost" type="button" data-auth="register" data-auth-account-type="${isPartner ? "pharmacy" : "patient"}" data-auth-target="${returnRoute}">${Ui.icon("user-plus")} Создать аккаунт</button>
              `}
            </div>
            ${isPartner ? `
              <div class="access-features">
                <span>${Ui.icon("shopping-bag")} Товары и остатки</span>
                <span>${Ui.icon("clipboard-list")} Реальные заказы</span>
                <span>${Ui.icon("chart-no-axes-column")} Аналитика</span>
                <span>${Ui.icon("hospital")} Несколько филиалов</span>
              </div>
            ` : ""}
          </section>
        </main>
        ${Ui.footer()}
      </div>
    `;
  }

  account(user) {
    if (!user || user.type !== "patient") return this.accessGate(user, "account", "account");
    const created = new Date(user.createdAt || Date.now()).toLocaleDateString("ru-RU");
    const orders = Array.isArray(user.orders) ? user.orders : [];
    const favorites = this.store.favoriteProducts();
    const notifications = this.store.accounts.patientNotifications();
    const unreadNotifications = notifications.filter((item) => !item.read).length;
    return `
      <div class="page patient-account-page">
        ${Ui.publicHeader(user)}
        <main class="container account-layout">
          <section class="account-main">
            <div class="page-title account-heading">
              <div>
                <span class="geo-pill">${Ui.icon("user")} Аккаунт пациента</span>
                <h1>Здравствуйте, ${Format.escape(user.name.split(" ")[0] || user.name)}!</h1>
                <p>Управляйте контактами и адресом доставки. Изменения сохраняются в вашем аккаунте.</p>
              </div>
              <span class="account-avatar">${Format.escape(user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase())}</span>
            </div>

            <div class="account-stats">
              <article class="panel"><span class="icon-tile">${Ui.icon("calendar")}</span><div><small>С нами с</small><strong>${created}</strong></div></article>
              <article class="panel"><span class="icon-tile">${Ui.icon("map-pin")}</span><div><small>Адрес доставки</small><strong>${user.address ? "Добавлен" : "Не указан"}</strong></div></article>
              <article class="panel"><span class="icon-tile">${Ui.icon("clipboard-list")}</span><div><small>Заказы</small><strong>${orders.length}</strong></div></article>
              <article class="panel"><span class="icon-tile">${Ui.icon("bell")}</span><div><small>Новые события</small><strong>${unreadNotifications}</strong></div></article>
            </div>

            <form class="panel account-form" data-patient-profile>
              <div class="panel-head">
                <div><h2>Личные данные</h2><p class="muted">Имя и контакты будут использоваться при оформлении заказа.</p></div>
                <button class="btn primary" type="submit">${Ui.icon("check")} Сохранить</button>
              </div>
              <div class="account-fields">
                <label>Имя и фамилия<input name="name" required value="${Format.escape(user.name)}" /></label>
                <label>Телефон или email<input name="contact" required value="${Format.escape(user.contact)}" /></label>
                <label class="account-address">Адрес доставки<input name="address" value="${Format.escape(user.address || "")}" placeholder="Ташкент, улица, дом, квартира" /></label>
              </div>
              <div class="patient-location-card">
                <div>
                  <span class="icon-tile">${Ui.icon("map-pin")}</span>
                  <span><small>Точка доставки на карте</small><strong>${user.latitude !== null && user.latitude !== undefined && user.latitude !== "" && user.longitude !== null && user.longitude !== undefined && user.longitude !== "" && Number.isFinite(Number(user.latitude)) && Number.isFinite(Number(user.longitude)) ? `${Number(user.latitude).toFixed(5)}, ${Number(user.longitude).toFixed(5)}` : "Не выбрана"}</strong></span>
                </div>
                <button class="btn ghost" type="button" data-customer-location>${Ui.icon("map-pin")} Выбрать на карте</button>
              </div>
            </form>

            <form class="panel account-form" data-password-form>
              <div class="panel-head">
                <div><h2>Безопасность</h2><p class="muted">Для смены пароля укажите текущий пароль.</p></div>
              </div>
              <div class="account-fields password-fields">
                <label>Текущий пароль<input name="currentPassword" type="password" required autocomplete="current-password" /></label>
                <label>Новый пароль<input name="newPassword" type="password" minlength="6" required autocomplete="new-password" /></label>
                <button class="btn ghost" type="submit">${Ui.icon("lock")} Изменить пароль</button>
              </div>
            </form>
          </section>

          <aside class="account-side">
            <section class="panel account-side-card patient-notification-card">
              <div class="panel-head slim">
                <div>
                  <h3>Уведомления</h3>
                  <p class="muted">${unreadNotifications ? `${unreadNotifications} новых событий` : "Все спокойно"}</p>
                </div>
                ${notifications.length ? `<button class="btn small ghost" type="button" data-patient-notifications-read>Прочитать все</button>` : ""}
              </div>
              ${notifications.length
                ? notifications.slice(0, 6).map((notification) => `<button class="patient-notification-row ${notification.read ? "" : "unread"}" type="button" data-patient-notification="${Format.escape(notification.id)}" data-order-id="${Format.escape(notification.orderId || "")}"><span class="icon-tile ${Format.escape(notification.tone || "blue")}">${Ui.icon(notification.icon || "bell")}</span><span><strong>${Format.escape(notification.title)}</strong><small>${Format.escape(notification.text || "")}</small><time>${Format.escape(Format.dateTime(notification.createdAt || new Date()))}</time></span></button>`).join("")
                : '<p class="muted">Здесь появятся статусы заказов, ответы аптек и важные события аккаунта.</p>'}
            </section>
            <section class="panel account-side-card">
              <span class="icon-tile">${Ui.icon("shopping-bag")}</span>
              <h3>История заказов</h3>
              ${orders.length
                ? orders.slice(0, 4).map((order) => `<button class="patient-order-link" type="button" data-patient-order="${Format.escape(order.id)}"><span><strong>#${Format.escape(order.id)}</strong><small>${Format.escape(order.pharmacyName || "")} · ${Format.money(order.amount)}</small></span><span class="status ${Ui.statusClass(order.status)}">${Format.escape(order.status)}</span></button>`).join("")
                : '<p class="muted">Новые заказы будут появляться здесь после оформления.</p>'}
              ${orders.length ? `<button class="btn ghost" type="button" data-patient-repeat="${Format.escape(orders[0].id)}">${Ui.icon("refresh-cw")} Повторить последний</button>` : ""}
              <a class="btn primary" href="${orders.length ? "#order" : "#search"}">${orders.length ? "Все заказы" : "Перейти в каталог"}</a>
            </section>
            <section class="panel account-side-card">
              <span class="icon-tile">${Ui.icon("heart")}</span>
              <h3>Избранное</h3>
              ${favorites.length
                ? favorites.slice(0, 4).map((product) => `<button class="favorite-row" type="button" data-product-select="${Format.escape(product.id)}">${Ui.packshot(product, "small")}<span><strong>${Format.escape(product.name)}</strong><small>${Format.escape(product.subtitle || product.priceLabel)}</small></span></button>`).join("")
                : '<p class="muted">Сохранённые товары появятся здесь.</p>'}
              <a class="btn ghost" href="#search">${Ui.icon("search")} Найти товары</a>
            </section>
            <section class="panel account-side-card">
              <span class="icon-tile">${Ui.icon("headphones")}</span>
              <h3>Нужна помощь?</h3>
              <p class="muted">Поддержка DoriGo поможет с аккаунтом и заказами.</p>
              <a class="btn ghost" href="mailto:support@dorigo.uz">Написать в поддержку</a>
            </section>
          </aside>
        </main>
        ${Ui.footer()}
      </div>
    `;
  }

  home(homeCategory = "all") {
    const catalogCount = this.store.searchProducts({}).length;
    const pharmacyCount = this.store.accounts.marketplacePharmacies().length;
    return `
      <div class="page public-home">
        ${Ui.publicHeader(this.store.accounts.currentUser())}
        <main>
          <section class="container hero">
            <div class="hero-copy">
              <span class="geo-pill">${Ui.icon("map-pin")} Доставка из аптек Ташкента</span>
              <h1>Лекарства и товары для здоровья с доставкой из аптек <em>Ташкента</em></h1>
              <p class="lead">Находим в аптеках, сравниваем цены и привозим к вам домой быстро и удобно.</p>
              <div class="button-row">
                <a class="btn primary" href="#search">${Ui.icon("search")} Найти лекарство</a>
                <a class="btn ghost" href="#partner">${Ui.icon("briefcase-business")} Стать партнером</a>
              </div>
            </div>
            <div class="hero-visual" aria-label="Лекарства с доставкой по Ташкенту">
              <div class="hero-bag-brand">${Ui.brand()}</div>
            </div>
          </section>
          <section class="container search-panel" aria-label="Поиск">
            <div class="field has-icon">
              <label>Что ищете?</label>
              ${Ui.icon("search")}
              <input data-home-search type="search" placeholder="Введите название лекарства или товара" />
            </div>
            <div class="field">
              <label>Где вы находитесь?</label>
              <button class="location-field-button" type="button" data-customer-location>
                ${Ui.icon("map-pin")}
                <span>${Format.escape(this.store.customerLocation.label || "Выбрать точку доставки")}</span>
              </button>
            </div>
            <button class="btn blue" type="button" data-home-search-submit>Найти</button>
            <div class="search-hints">
              <span>${Ui.icon("check")} В каталоге ${catalogCount} ${catalogCount === 1 ? "товар" : "товаров"}</span>
              <span>${Ui.icon("hospital")} ${pharmacyCount} ${pharmacyCount === 1 ? "зарегистрированная аптека" : "зарегистрированных аптек"}</span>
              <span>${Ui.icon("truck")} Доставка от 1 часа</span>
            </div>
          </section>
          ${this.trustBoard()}
          ${this.categories(homeCategory)}
          ${this.popular(homeCategory)}
          ${this.howItWorks()}
        </main>
        ${Ui.footer()}
      </div>
    `;
  }

  trustBoard() {
    const pharmacies = this.store.accounts.marketplacePharmacies();
    const offers = pharmacies.flatMap(({ pharmacy }) => Array.isArray(pharmacy.inventory) ? pharmacy.inventory : []);
    const liveOffers = offers.filter((offer) => offer.published !== false && Number(offer.price) > 0);
    const verifiedCards = this.store.catalogProducts.filter((product) => product.sourceVerified).length;
    const cardsWithPhotos = this.store.catalogProducts.filter((product) => Ui.productImages(product).length).length;
    const deliveryEnabled = pharmacies.filter(({ pharmacy }) => pharmacy.delivery?.enabled !== false).length;
    const rows = [
      ["star", "Умный выбор", "DoriGo считает итоговую стоимость, расстояние, скорость доставки, свежесть остатков и доверие к аптеке."],
      ["shield-check", "Единая карточка", `${verifiedCards} карточек подтверждены источником, ${cardsWithPhotos} имеют фото и описание без дублей.`],
      ["activity", "Живые остатки", `${liveOffers.length} предложений аптек обновляются из кабинета партнёра и Excel-загрузок.`],
      ["route", "Маршрут доставки", `${deliveryEnabled} аптек готовы к доставке: клиент и аптека выбирают точки на карте.`],
    ];
    return `
      <section class="container trust-board" aria-label="Преимущества DoriGo">
        <div class="trust-board-head">
          <span class="geo-pill">${Ui.icon("badge-check")} Умная проверка DoriGo</span>
          <h2>Выбираем аптеку прозрачнее обычной выдачи</h2>
          <p class="muted">Покупатель видит не только цену, а понятную причину выбора: кто ближе, где есть остаток, сколько выйдет с доставкой и насколько свежие данные аптеки.</p>
        </div>
        <div class="trust-board-grid">
          ${rows.map(([icon, title, text]) => `
            <article class="trust-card">
              <span class="icon-tile">${Ui.icon(icon)}</span>
              <strong>${title}</strong>
              <p>${text}</p>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  categories(activeCategory = "all") {
    const categories = [
      ["otc", "pill", "OTC", "Без рецепта", "green"],
      ["supplements", "leaf", "БАДы", "Добавки", "orange"],
      ["vitamins", "shield", "Витамины", "и минералы", "blue"],
      ["beauty", "sparkles", "Красота", "и уход", "red"],
      ["mother", "baby", "Мама", "и ребенок", "purple"],
      ["medical", "briefcase-medical", "Медизделия", "и гигиена", "cyan"],
      ["sports", "activity", "Спортпит", "и восстановление", "orange"],
    ];

    return `
      <section class="container category-strip" aria-label="Категории товаров">
        ${categories
          .map(([key, icon, title, text, color]) => `
            <button class="category-card ${activeCategory === key ? "active" : ""}" type="button" data-home-category="${key}" aria-pressed="${activeCategory === key}">
              <span class="icon-tile" style="background: var(--${color}-soft, var(--green-soft)); color: var(--${color}, var(--green));">${Ui.icon(icon)}</span>
              <span><strong>${title}</strong><span>${text}</span></span>
            </button>
          `)
          .join("")}
      </section>
    `;
  }

  popular(homeCategory = "all") {
    const labels = {
      all: "Популярные товары",
      otc: "Безрецептурные препараты",
      supplements: "БАДы и добавки",
      vitamins: "Витамины и минералы",
      beauty: "Красота и уход",
      mother: "Для мамы и ребёнка",
      medical: "Медизделия и гигиена",
      sports: "Спортивное питание",
    };
    const products = homeCategory === "all"
      ? this.store.popularProducts()
      : this.store.homeCategoryProducts(homeCategory);
    return `
      <section class="container popular-products-section" data-product-carousel>
        <div class="section-head">
          <h2>${labels[homeCategory] || labels.all}</h2>
          <div class="product-carousel-actions">
            <span class="product-carousel-status" data-product-carousel-status aria-live="polite"></span>
            <button class="icon-button" type="button" data-product-carousel-prev aria-label="Предыдущие препараты">${Ui.icon("chevron-left")}</button>
            <button class="icon-button" type="button" data-product-carousel-next aria-label="Следующие препараты">${Ui.icon("chevron-right")}</button>
            <a class="link-more" href="#search">Смотреть все ${Ui.icon("chevron-right")}</a>
          </div>
        </div>
        <div class="product-row product-carousel-track" data-product-carousel-track tabindex="0" aria-label="Популярные препараты">
          ${products.length
            ? products.map((product) => Ui.productCard(product, "home", this.store.isFavorite(product.id))).join("")
            : `<div class="empty-state"><span class="icon-tile">${Ui.icon("package")}</span><h3>В этой категории пока нет товаров</h3><p class="muted">Попробуйте выбрать другую подборку.</p></div>`}
        </div>
      </section>
    `;
  }

  howItWorks() {
    const steps = [
      ["search", "Найдите товар", "Поиск по названию или действующему веществу"],
      ["hospital", "Выберите аптеку", "Сравните цены и наличие в ближайших аптеках"],
      ["shopping-cart", "Оформите заказ", "Укажите адрес и удобное время доставки"],
      ["bike", "Получите доставку", "Мы быстро привезем заказ к вашей двери"],
    ];

    return `
      <section class="container">
        <div class="section-head"><h2>Как это работает</h2></div>
        <div class="how-grid">
          ${steps.map(([icon, title, text], index) => `
            <article class="how-card">
              <span class="step-number">${index + 1}</span>
              <span class="how-icon">${Ui.icon(icon)}</span>
              <div><strong>${title}</strong><p class="muted">${text}</p></div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  search(state = {}) {
    const products = this.store.searchProducts(state);
    const query = state.query?.trim() || "Все товары";
    const pageSize = 16;
    const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
    const currentPage = Math.min(totalPages, Math.max(1, Number(state.page) || 1));
    const pageStart = (currentPage - 1) * pageSize;
    const displayProducts = products.slice(pageStart, pageStart + pageSize);
    const paginationItems = [...new Set([
      1,
      totalPages,
      currentPage - 2,
      currentPage - 1,
      currentPage,
      currentPage + 1,
      currentPage + 2,
    ].filter((page) => page >= 1 && page <= totalPages))].sort((a, b) => a - b);
    const paginationMarkup = paginationItems.map((page, index) => {
      const previousPage = paginationItems[index - 1];
      const gap = previousPage && page - previousPage > 1 ? `<span class="pagination-gap" aria-hidden="true">…</span>` : "";
      return `${gap}<button type="button" data-catalog-page="${page}" class="${page === currentPage ? "active" : ""}" ${page === currentPage ? 'aria-current="page"' : ""}>${page}</button>`;
    }).join("");
    const view = state.view === "list" ? "list" : "grid";
    const sortOptions = [
      ["best", "Лучший вариант"],
      ["price", "По цене"],
      ["near", "По близости"],
      ["fast", "По скорости доставки"],
    ];

    return `
      <div class="page">
        ${Ui.publicHeader(this.store.accounts.currentUser())}
        <main class="container search-page">
          <div class="breadcrumb"><span>Главная</span><span>></span><span>Каталог</span><span>></span><span>${query}</span></div>
          <section class="search-hero">
            <div class="search-title">
              <span class="geo-pill">${Ui.icon("map-pin")} Ташкент</span>
              <h1>Результаты поиска: <em>${query}</em></h1>
              <p class="muted">Найдено ${products.length} товаров из ${this.store.products.length}</p>
            </div>
            <div class="search-banner">
              <h3>Поиск по действующему веществу</h3>
              <p class="muted">Каталог ищет по названию, id, МНН, описанию, форме выпуска и дозировке.</p>
            </div>
          </section>
          <div class="sort-row">
            <div class="segmented">
              ${sortOptions.map(([key, label]) => `<button type="button" data-sort="${key}" class="${state.sort === key ? "active" : ""}">${label}</button>`).join("")}
            </div>
            <div class="view-switch">
              <button type="button" data-view="grid" class="${view === "grid" ? "active" : ""}">${Ui.icon("layout-grid")} Сетка</button>
              <button type="button" data-view="list" class="${view === "list" ? "active" : ""}">${Ui.icon("list")} Список</button>
            </div>
          </div>
          <div class="catalog-grid">
            ${this.filters(state)}
            <div>
              <div class="catalog-products ${view}">
                ${displayProducts.length
                  ? displayProducts.map((product) => Ui.productCard(product, view, this.store.isFavorite(product.id))).join("")
                  : `<div class="empty-state"><span class="icon-tile">${Ui.icon("package")}</span><h3>Каталог препаратов пуст</h3><p class="muted">Сейчас в магазине нет ни одного препарата.</p></div>`}
              </div>
              ${products.length ? `
                <div class="catalog-pagination-wrap">
                  <p class="pagination-summary">Показано ${pageStart + 1}–${Math.min(pageStart + pageSize, products.length)} из ${products.length}</p>
                  <nav class="pagination" aria-label="Страницы каталога">
                    <button type="button" data-catalog-page="${currentPage - 1}" aria-label="Предыдущая страница" ${currentPage === 1 ? "disabled" : ""}>${Ui.icon("chevron-left")}</button>
                    ${paginationMarkup}
                    <button type="button" data-catalog-page="${currentPage + 1}" aria-label="Следующая страница" ${currentPage === totalPages ? "disabled" : ""}>${Ui.icon("chevron-right")}</button>
                  </nav>
                </div>
              ` : ""}
            </div>
          </div>
        </main>
        ${Ui.footer()}
      </div>
    `;
  }

  filters(state = {}) {
    const categories = this.store.facet("category");
    const forms = this.store.facet("form");
    const dosages = this.store.facet("dosageGroup");

    return `
      <aside class="filter-panel">
        <div class="filter-group">
          <div class="filter-title"><span>Поиск</span>${Ui.icon("search")}</div>
          <input class="filter-input" data-search-query type="search" value="${state.query || ""}" placeholder="Название, id, МНН..." />
        </div>
        ${this.filterGroup("Категория", "categories", categories, state.categories)}
        ${this.filterGroup("Форма", "forms", forms, state.forms)}
        ${this.filterGroup("Дозировка", "dosages", dosages, state.dosages)}
        <div class="filter-group">
          <div class="filter-title"><span>Цена, сум</span>${Ui.icon("sliders-horizontal")}</div>
          <div class="price-filter">
            <input data-price-min type="number" min="0" step="1000" value="${state.minPrice || ""}" placeholder="от 2 000" />
            <input data-price-max type="number" min="0" step="1000" value="${state.maxPrice || ""}" placeholder="до 500 000" />
          </div>
        </div>
        <div class="filter-group">
          <label class="toggle-row"><span>Только в наличии</span><input class="toggle-input" data-toggle="inStock" type="checkbox" ${state.inStock ? "checked" : ""} /><span class="toggle"></span></label>
          <label class="toggle-row"><span>Доставка сегодня</span><input class="toggle-input" data-toggle="deliveryToday" type="checkbox" ${state.deliveryToday ? "checked" : ""} /><span class="toggle"></span></label>
          <label class="toggle-row"><span>Без рецепта</span><input class="toggle-input" data-toggle="otcOnly" type="checkbox" ${state.otcOnly ? "checked" : ""} /><span class="toggle"></span></label>
          <button class="btn ghost" type="button" data-clear-filters style="width: 100%; margin-top: 12px;">Очистить фильтры</button>
        </div>
      </aside>
    `;
  }

  filterGroup(title, type, items, selected = new Set()) {
    return `
      <div class="filter-group">
        <div class="filter-title"><span>${title}</span>${Ui.icon("chevron-up")}</div>
        ${items.map((item) => `<label class="check-row"><input data-filter-type="${type}" type="checkbox" value="${item.value}" ${selected?.has(item.value) ? "checked" : ""} /> <span>${item.value} (${item.count})</span></label>`).join("")}
      </div>
    `;
  }

  product(activeTab = "description") {
    const currentUser = this.store.accounts.currentUser();
    const activePharmacy = currentUser?.type === "pharmacy" ? this.store.accounts.activePharmacy() : null;
    const main = this.store.productById(this.store.selectedProductId) || this.store.popularProducts()[0];
    if (!main) {
      return `
        <div class="page">
          ${Ui.publicHeader(currentUser)}
          <main class="container search-page">
            <div class="breadcrumb"><span>Главная</span><span>></span><span>Каталог</span></div>
            <div class="empty-state catalog-empty-page">
              <span class="icon-tile">${Ui.icon("package")}</span>
              <h1>Каталог препаратов пуст</h1>
              <p class="muted">Карточки появятся после импорта официального государственного реестра.</p>
              <a class="btn primary" href="#home">Вернуться на главную</a>
            </div>
          </main>
          ${Ui.footer()}
        </div>
      `;
    }
    const offers = this.store.marketplaceOffers(main.id);
    const nearest = [...offers].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))[0] || null;
    const best = offers[0] || null;
    const bestAvailable = Boolean(best && best.available > 0);
    const location = this.store.customerLocation;
    const mapTarget = nearest?.pharmacy || location;
    const productMapCenter = nearest
      ? {
        latitude: (Number(nearest.pharmacy.latitude) + Number(location.latitude)) / 2,
        longitude: (Number(nearest.pharmacy.longitude) + Number(location.longitude)) / 2,
      }
      : mapTarget;
    const productMapMarkers = nearest
      ? [
        { latitude: nearest.pharmacy.latitude, longitude: nearest.pharmacy.longitude, type: "pharmacy", icon: "hospital", label: nearest.pharmacy.name, active: true },
        { latitude: location.latitude, longitude: location.longitude, type: "client", icon: "map-pin", label: location.label },
      ]
      : [{ latitude: mapTarget.latitude, longitude: mapTarget.longitude, type: "client", icon: "map-pin", label: location.label, active: true }];
    const productStatus = main.prescriptionStatus || (main.rxRequired ? "По рецепту" : "Без рецепта");
    const packageSize = main.packageSize || (main.subtitle?.match(/N\d+/i) || ["Уточняется"])[0];
    const galleryImages = Ui.productImages(main);
    const relatedProducts = this.store.relatedProducts(main);
    const imageSources = Array.from(new Map(
      galleryImages
        .filter((image) => image.sourceUrl)
        .map((image) => [image.sourceUrl, {
          name: image.sourceName || "Источник фото",
          url: image.sourceUrl,
        }]),
    ).values());
    const productTab = ["description", "usage", "characteristics"].includes(activeTab) ? activeTab : "description";
    return `
      <div class="page">
        ${Ui.publicHeader(currentUser)}
        <main class="container product-detail-grid">
          <section>
            <div class="breadcrumb"><a href="#home">Главная</a><span>></span><a href="#search">Каталог</a><span>></span><span>${Format.escape(main.name)}</span></div>
            <div class="product-hero-detail">
              <div>
                <div class="gallery-main">
                  ${galleryImages.length
                    ? `<img class="product-gallery-main-image" src="${Format.escape(galleryImages[0].data)}" alt="${Format.escape(main.name)}" />`
                    : Ui.packshot(main)}
                </div>
                ${galleryImages.length
                  ? `<div class="thumb-row product-gallery-thumbs">${galleryImages.map((image, index) => `
                      <button class="thumb ${index === 0 ? "active" : ""}" type="button" data-gallery-image="${index}" aria-label="Показать фото ${index + 1}" title="${Format.escape(image.sourceName ? `${image.name} · ${image.sourceName}` : image.name)}">
                        <img src="${Format.escape(image.data)}" alt="${Format.escape(image.name)}" />
                      </button>
                    `).join("")}</div>`
                  : `<div class="thumb-row"><div class="thumb">${Ui.packshot(main, "small")}</div><div class="thumb">${Ui.icon("tablets")}</div><div class="thumb">${Ui.icon("file-text")}</div></div>`}
                ${main.imageMatch?.verified ? `
                  <div class="image-verification">
                    <span class="image-verification-icon">${Ui.icon("badge-check")}</span>
                    <div>
                      <strong>Фото сверено с карточкой</strong>
                      <span>${Format.escape([
                        main.imageMatch.dosage,
                        main.imageMatch.form,
                        main.imageMatch.packageSize,
                      ].filter(Boolean).join(" · "))}</span>
                      <small>${Format.escape(main.imageMatch.manufacturer || "")}</small>
                      ${imageSources.length ? `<small class="image-source-links">Источники фото: ${imageSources.map((source) => `
                        <a href="${Format.escape(source.url)}" target="_blank" rel="noopener noreferrer">${Format.escape(source.name)}</a>
                      `).join(", ")}</small>` : ""}
                    </div>
                  </div>
                ` : ""}
              </div>
              <div class="product-info">
                <h1>${Format.escape(main.name)} ${Format.escape(main.subtitle || "")}</h1>
                <div class="tag-list"><span class="badge ${main.rxRequired ? "orange" : "green"}">${Format.escape(productStatus)}</span><span class="badge blue">${Format.escape(main.category || "Прочее")}</span></div>
                <div class="product-primary-actions">
                  <button class="btn ghost" type="button" data-favorite-toggle="${Format.escape(main.id)}">${Ui.icon("heart")} ${this.store.isFavorite(main.id) ? "В избранном" : "Добавить в избранное"}</button>
                </div>
                <p class="lead">${Format.escape(main.sourceVerified && main.description ? main.description : "Официальное описание для этой карточки ещё не загружено.")}</p>
                <div class="fact-grid">
                  ${this.fact("badge-check", "Производитель", Format.escape(main.manufacturer || "Нет данных в реестре"))}
                  ${this.fact("pill", "Форма выпуска", Format.escape(main.form || "Уточняется"))}
                  ${this.fact("flask-conical", "Действующее вещество", Format.escape(main.mnn || main.ingredient || "Уточняется"))}
                </div>
                <p class="product-source-note">${Ui.icon("badge-check")} Цены и остатки ниже получены из кабинетов зарегистрированных аптек.</p>
              </div>
            </div>

            <section class="location-toolbar panel">
              <div class="location-copy">
                <span class="icon-tile">${Ui.icon("navigation")}</span>
                <div><small>Расстояние рассчитано от</small><strong>${Format.escape(location.label)}</strong><p class="muted">${location.source === "default" ? "Укажите геолокацию, чтобы увидеть точное расстояние." : "Координаты сохранены для следующих покупок."}</p></div>
              </div>
              <button class="btn ghost" type="button" data-customer-location>${Ui.icon("map-pin")} Моё местоположение</button>
            </section>

            <div class="offers-heading">
              <div><h2>Где купить</h2><p class="muted">${offers.length ? `${offers.length} ${offers.length === 1 ? "аптека продаёт" : "аптек продают"} этот товар` : "Зарегистрированные аптеки пока не добавили этот товар"}</p></div>
              <div class="segmented offer-sort">
                <button class="${this.store.offerSort === "best" ? "active" : ""}" data-offer-sort="best">${Ui.icon("star")} Лучший</button>
                <button class="${this.store.offerSort === "price" ? "active" : ""}" data-offer-sort="price">По цене</button>
                <button class="${this.store.offerSort === "distance" ? "active" : ""}" data-offer-sort="distance">По расстоянию</button>
                <button class="${this.store.offerSort === "fastest" ? "active" : ""}" data-offer-sort="fastest">Быстрее</button>
              </div>
            </div>

            ${offers.length ? `
              <div class="offer-table real-offers">
                <div class="table-row table-head"><span>Аптека</span><span>Цена</span><span>Наличие</span><span>Получение</span><span>Расстояние</span><span></span></div>
                ${offers.map((item, index) => {
                  const isOwnOffer = Boolean(activePharmacy?.id && item.pharmacyId === activePharmacy.id);
                  const offerPublished = item.offer.published !== false;
                  return `
                  <article class="table-row offer-row ${index === 0 ? "recommended" : ""} ${item.id === this.store.highlightedOfferId ? "just-added" : ""}">
                    <div class="pharmacy-cell">
                      <span class="mini-logo">${item.pharmacy.logoData ? `<img src="${Format.escape(item.pharmacy.logoData)}" alt="" />` : Ui.icon("cross")}</span>
                      <div>
                        <strong>${Format.escape(item.pharmacy.name)}</strong>
                        <p class="muted">${Format.escape(item.pharmacy.address || item.pharmacy.district || "Адрес не указан")}</p>
                        ${item.id === this.store.highlightedOfferId ? '<span class="offer-recommendation offer-just-added">Добавлено сейчас</span>' : ""}
                        ${isOwnOffer ? '<span class="offer-recommendation offer-own">Ваша аптека</span>' : ""}
                        ${index === 0 ? '<span class="offer-recommendation">DoriGo рекомендует</span>' : ""}
                        <div class="offer-reasons">${item.advantages.map((reason) => `<span>${Format.escape(reason)}</span>`).join("")}</div>
                      </div>
                    </div>
                    <div><strong class="offer-price">${Format.money(item.price)}</strong><p class="muted">Итого ${Format.money(item.totalPrice)}</p></div>
                    <div><span class="status ${item.available > 0 ? "ok" : "danger"}">${item.available > 0 ? `${item.available} шт.` : "Нет"}</span><p class="muted">${item.reserve ? `В резерве: ${item.reserve}` : "Доступно сейчас"}</p></div>
                    <div>
                      ${item.deliveryAvailable ? `<strong>${item.deliveryMinutes} мин</strong><p class="muted">Доставка ${item.deliveryFee ? Format.money(item.deliveryFee) : "бесплатно"}</p>` : `<strong>${item.pickupAvailable ? "Самовывоз" : "Недоступно"}</strong><p class="muted">${item.distance !== null ? "Вне зоны доставки" : "Нужно местоположение"}</p>`}
                    </div>
                    <div><strong>${item.distance === null ? "—" : `${item.distance.toFixed(1)} км`}</strong><a class="map-route-link" href="${Format.escape(item.directionsUrl)}" target="_blank" rel="noopener">${Ui.icon("navigation")} Маршрут</a></div>
                    <div class="offer-actions">
                      <span class="dorigo-score" title="Рейтинг рассчитывает цену, расстояние, доставку, свежесть остатков и доверие к аптеке">${item.qualityScore}</span>
                      ${isOwnOffer ? `
                        <button class="btn small ghost" type="button" data-product-edit="${Format.escape(item.offer.catalogId || item.offer.id)}">${Ui.icon("pencil")} Редактировать</button>
                        <button class="btn small ghost" type="button" data-product-publish="${Format.escape(item.offer.id)}" data-published="${offerPublished ? "1" : "0"}">${Ui.icon(offerPublished ? "archive" : "eye")} ${offerPublished ? "Скрыть" : "Показать"}</button>
                      ` : `<button class="btn small primary" type="button" data-offer-select="${Format.escape(item.id)}" ${item.available < 1 ? "disabled" : ""}>Выбрать</button>`}
                    </div>
                  </article>
                `;
                }).join("")}
              </div>
            ` : `
              <div class="empty-state offers-empty">
                <span class="icon-tile">${Ui.icon("hospital")}</span>
                <h3>Предложений пока нет</h3>
                <p class="muted">Товар появится здесь, когда зарегистрированная аптека укажет цену, остаток и опубликует предложение.</p>
                <div class="button-row">
                  <a class="btn ghost" href="#search">Вернуться в каталог</a>
                  ${currentUser?.type === "pharmacy" ? `<button class="btn primary" type="button" data-product-add-catalog="${Format.escape(main.id)}">${Ui.icon("plus")} Добавить предложение</button>` : `<a class="btn ghost" href="#partner">${Ui.icon("store")} Для аптек</a>`}
                </div>
              </div>
            `}

            <div class="description-panel panel">
              <div class="product-tabs" role="tablist" aria-label="Информация о препарате">
                <button class="${productTab === "description" ? "active" : ""}" type="button" data-product-tab="description">Описание</button>
                <button class="${productTab === "usage" ? "active" : ""}" type="button" data-product-tab="usage">Способ применения</button>
                <button class="${productTab === "characteristics" ? "active" : ""}" type="button" data-product-tab="characteristics">Характеристики</button>
              </div>
              ${this.productDetailContent(main, productTab, packageSize)}
            </div>
            <section class="related-products-section" data-product-carousel>
              <div class="section-head">
                <h2>Похожие товары</h2>
                <div class="product-carousel-actions">
                  <span class="product-carousel-status" data-product-carousel-status aria-live="polite"></span>
                  <button class="icon-button" type="button" data-product-carousel-prev aria-label="Предыдущие похожие препараты">${Ui.icon("chevron-left")}</button>
                  <button class="icon-button" type="button" data-product-carousel-next aria-label="Следующие похожие препараты">${Ui.icon("chevron-right")}</button>
                  <a class="link-more" href="#search">Смотреть все ${Ui.icon("chevron-right")}</a>
                </div>
              </div>
              <div class="product-row product-carousel-track related-product-carousel" data-product-carousel-track tabindex="0" aria-label="Похожие препараты">
                ${relatedProducts.length
                  ? relatedProducts.map((product) => Ui.productCard(product, "related", this.store.isFavorite(product.id))).join("")
                  : `<div class="empty-state"><span class="icon-tile">${Ui.icon("package")}</span><h3>Похожие препараты пока не найдены</h3></div>`}
              </div>
            </section>
          </section>
          <aside class="side-stack">
            <div class="buy-box">
              <div class="buy-price">${best ? `от ${Format.money(best.price)}` : "Нет предложений"}</div>
              <p class="muted">${bestAvailable ? "Минимальная актуальная цена" : best ? "Предложение есть, но остаток закончился" : "Аптеки ещё не выставили товар"}</p>
              <div class="buy-stats">
                <div>${Ui.icon("badge-check")}<strong>${best ? Format.money(best.price) : "—"}</strong><span>Минимальная цена</span></div>
                <div>${Ui.icon("briefcase-business")}<strong>${offers.length}</strong><span>Зарегистрированных аптек</span></div>
                <div>${Ui.icon("truck")}<strong>${offers.some((item) => item.deliveryAvailable) ? "Доступна" : "Самовывоз"}</strong><span>Получение товара</span></div>
              </div>
              ${best ? `
                <div class="smart-choice">
                  <div><span class="dorigo-score large">${best.qualityScore}</span><div><strong>DoriGo рекомендует</strong><p class="muted">Рейтинг учитывает полную стоимость, расстояние, доставку, остаток и проверку аптеки.</p></div></div>
                  <ul>${best.advantages.map((reason) => `<li>${Format.escape(reason)}</li>`).join("")}</ul>
                  <p class="smart-choice-total"><span>Итого с доставкой</span><strong>${Format.money(best.totalPrice)}</strong></p>
                </div>
              ` : ""}
              ${best ? `<button class="btn primary" style="width:100%;" type="button" data-offer-select="${Format.escape(best.id)}" ${bestAvailable ? "" : "disabled"}>${bestAvailable ? "Выбрать лучший вариант" : "Нет доступного остатка"}</button>` : currentUser?.type === "pharmacy" ? `<button class="btn primary" style="width:100%;" type="button" data-product-add-catalog="${Format.escape(main.id)}">${Ui.icon("plus")} Подключить товар к аптеке</button>` : ""}
            </div>
            <div class="side-card pharmacy-map-card">
              <div class="panel-head"><div><h3>Аптеки на карте</h3><p class="muted">${nearest ? Format.escape(nearest.pharmacy.name) : "Ваше местоположение"}</p></div><span class="icon-tile">${Ui.icon("map-pin")}</span></div>
              ${Ui.mapSurface({
                latitude: productMapCenter.latitude,
                longitude: productMapCenter.longitude,
                zoom: nearest ? 12 : 14,
                className: "side-map-surface",
                label: "Карта ближайшей аптеки и точки клиента",
                route: Boolean(nearest),
                markers: productMapMarkers,
              })}
              ${nearest ? `<a class="btn ghost" href="${Format.escape(nearest.directionsUrl)}" target="_blank" rel="noopener">${Ui.icon("navigation")} Открыть в Google Maps</a>` : ""}
            </div>
            ${this.sideProducts("Похожие товары", relatedProducts.slice(0, 4))}
            ${this.sideProducts("Вы смотрели", this.store.products.slice(2, 4))}
          </aside>
        </main>
        ${Ui.footer()}
      </div>
    `;
  }

  productDetailContent(product, activeTab, packageSize) {
    const unavailable = (label) => `<div class="official-data-empty">${Ui.icon("info")} <span>${label} пока не загружено из официального источника.</span></div>`;
    const sourceDate = product.sourceUpdatedAt
      ? new Date(product.sourceUpdatedAt).toLocaleDateString("ru-RU")
      : "";
    const medicalNotice = `<div class="medical-notice">${Ui.icon("shield-alert")} Информация на сайте не заменяет консультацию врача. Применяйте препарат только по официальной инструкции и назначению специалиста.</div>`;
    const sourceBlock = `
      <aside class="official-source-card">
        <div class="official-source-head">
          <span class="icon-tile">${Ui.icon(product.sourceVerified ? "badge-check" : "circle-alert")}</span>
          <div><strong>${product.sourceVerified ? "Данные подтверждены" : "Карточка ожидает официальных данных"}</strong><p class="muted">${Format.escape(product.sourceName || "Источник ещё не указан")}${sourceDate ? ` · обновлено ${sourceDate}` : ""}</p></div>
        </div>
        ${product.sourceUrl ? `<a class="btn ghost" href="${Format.escape(product.sourceUrl)}" target="_blank" rel="noopener">${Ui.icon("external-link")} Открыть источник</a>` : ""}
        ${product.instructionUrl ? `<a class="btn ghost" href="${Format.escape(product.instructionUrl)}" target="_blank" rel="noopener">${Ui.icon("file-text")} Официальная инструкция</a>` : ""}
      </aside>
    `;

    if (activeTab === "usage") {
      return `<div class="description-grid product-tab-panel" role="tabpanel">
        <div class="product-copy">
          <h3>Способ применения</h3>
          ${product.sourceVerified && product.usage ? Format.paragraphs(product.usage) : unavailable("Способ применения")}
          ${medicalNotice}
        </div>
        ${sourceBlock}
      </div>`;
    }

    if (activeTab === "characteristics") {
      const facts = [
        ["flask-conical", "МНН / действующее вещество", product.mnn || product.ingredient],
        ["package", "Форма выпуска", product.form],
        ["file-text", "Полная форма из реестра", product.dosageFormDetails],
        ["scale", "Дозировка", product.dosage],
        ["box", "Упаковка", packageSize],
        ["package-check", "Упаковка в официальном API", product.officialPackageName],
        ["factory", "Производитель", product.manufacturer],
        ["map-pin", "Страна", product.country],
        ["file-check", "Регистрационный номер", product.registrationNumber],
        ["calendar", "Дата регистрации / перерегистрации", product.registrationDate],
        ["calendar-check", "Начало действия удостоверения", product.officialRegistrationStartDate],
        ["refresh-cw", "Дата изменения", product.registrationChangeDate],
        ["refresh-cw", "Обновление официальной карточки", product.officialUpdatedAt],
        ["hash", "Код ATC", product.atcCode],
        ["activity", "Фармакотерапевтическая группа", product.pharmacotherapeuticGroup],
        ["clipboard-check", "Отпуск", product.prescriptionStatus || (product.rxRequired ? "По рецепту" : "Без рецепта")],
        ["archive", "Условия хранения", product.storageConditions],
      ];
      return `<div class="description-grid product-tab-panel" role="tabpanel">
        <div class="characteristics-list">
          ${facts.map(([icon, label, value]) => this.fact(icon, label, Format.escape(value || "Нет официальных данных"))).join("")}
          ${medicalNotice}
        </div>
        ${sourceBlock}
      </div>`;
    }

    return `<div class="description-grid product-tab-panel" role="tabpanel">
      <div class="product-copy">
        <h3>Описание</h3>
        ${product.sourceVerified && product.description ? Format.paragraphs(product.description) : unavailable("Описание препарата")}
        <h3>Показания</h3>
        ${product.sourceVerified && product.indications ? Format.paragraphs(product.indications) : unavailable("Показания")}
        <h3>Противопоказания</h3>
        ${product.sourceVerified && product.contraindications ? Format.paragraphs(product.contraindications) : unavailable("Противопоказания")}
        ${product.sourceVerified && product.composition ? `<h3>Состав</h3>${Format.paragraphs(product.composition)}` : ""}
        ${medicalNotice}
      </div>
      ${sourceBlock}
    </div>`;
  }

  fact(icon, title, value) {
    return `<div class="fact">${Ui.icon(icon)}<div><span class="muted">${title}</span><br /><strong>${value}</strong></div></div>`;
  }

  sideProducts(title, products) {
    return `
      <div class="side-card">
        <div class="panel-head" style="padding: 0 0 12px; min-height: auto;"><h3>${title}</h3><a class="link-more" href="#search">Все</a></div>
        ${products.map((product) => `<a class="mini-product" href="#product" data-product-select="${Format.escape(product.id)}">${Ui.packshot(product, "small")}<span><strong>${Format.escape(product.name)}</strong><br /><span class="muted">${product.priceLabel}</span></span></a>`).join("")}
      </div>
    `;
  }

  order() {
    const user = this.store.accounts.currentUser();
    if (!user || user.type !== "patient") return this.accessGate(user, "account", "order");
    if (this.store.checkoutMode && this.store.selectedOffer()) return this.checkout();

    const order = this.store.currentPatientOrder();
    if (!order) {
      return `
        <div class="page">
          ${Ui.publicHeader(user)}
          <main class="container access-page">
            <section class="access-card">
              <span class="access-icon">${Ui.icon("clipboard-list")}</span>
              <h1>Заказов пока нет</h1>
              <p>Выберите товар и аптеку. Новый заказ сразу появится здесь и в кабинете выбранной аптеки.</p>
              <a class="btn primary" href="#search">${Ui.icon("search")} Перейти в каталог</a>
            </section>
          </main>
          ${Ui.footer()}
        </div>
      `;
    }
    const timeline = ["Новый", "Подтвержден", "Собирается", "Собран", "Передан курьеру", "В пути", "Доставлен"];
    const currentIndex = Math.max(0, timeline.indexOf(order.status));
    const pharmacy = {
      latitude: order.pharmacyLatitude,
      longitude: order.pharmacyLongitude,
    };
    const orderClientLocation = {
      latitude: Number(order.clientLatitude) || this.store.customerLocation.latitude,
      longitude: Number(order.clientLongitude) || this.store.customerLocation.longitude,
    };
    const directionsUrl = this.store.googleRouteUrl(pharmacy, orderClientLocation);
    const orderMapCenter = {
      latitude: (Number(order.pharmacyLatitude) + Number(orderClientLocation.latitude)) / 2,
      longitude: (Number(order.pharmacyLongitude) + Number(orderClientLocation.longitude)) / 2,
    };
    const showCourier = order.type === "Доставка" && ["Передан курьеру", "В пути", "Доставлен"].includes(order.status) && order.courierName;
    const courierPhone = String(order.courierPhone || "").trim();
    const history = this.store.patientOrders();
    const review = order.review && typeof order.review === "object" ? order.review : null;
    const pharmacyReviewResponse = order.reviewResponse && typeof order.reviewResponse === "object" ? order.reviewResponse : null;
    const reviewRating = Math.max(1, Math.min(5, Number(review?.rating) || 5));
    return `
      <div class="page">
        ${Ui.publicHeader(user)}
        <main class="container order-layout">
          <section class="order-main panel">
            <div class="breadcrumb"><a href="#home">Главная</a><span>></span><a href="#account">Мой кабинет</a><span>></span><span>Заказ #${Format.escape(order.id)}</span></div>
            <div class="page-title">
              <div><h1>Заказ #${Format.escape(order.id)}</h1><p>Оформлен ${new Date(order.createdAt || `${order.date}T${order.time}`).toLocaleString("ru-RU")}</p></div>
              <span class="status ${Ui.statusClass(order.status)}">${Format.escape(order.status)}</span>
            </div>
            <div class="timeline">
              ${timeline.map((step, index) => `
                <div class="timeline-step ${index < currentIndex ? "done" : index === currentIndex ? "active" : ""}">
                  <span class="timeline-dot">${Ui.icon(index < currentIndex ? "check" : index === currentIndex ? "package" : "package-check")}</span>
                  <strong>${step}</strong>
                </div>
              `).join("")}
            </div>
            <div class="order-status-note">
              <span class="icon-tile">${Ui.icon(order.status === "Доставлен" ? "check-circle" : "clock")}</span>
              <div><strong>${order.status === "Новый" ? "Аптека получила заказ" : order.status === "Доставлен" ? "Заказ доставлен" : `Текущий статус: ${Format.escape(order.status)}`}</strong><p class="muted">Изменения статуса синхронизируются с кабинетом аптеки.</p></div>
              ${order.type === "Доставка" && ["Передан курьеру", "В пути"].includes(order.status) && order.confirmationCode ? `<div class="patient-confirmation-code"><small>Код вручения</small><strong>${Format.escape(order.confirmationCode)}</strong><span>Назовите его курьеру</span></div>` : ""}
              ${showCourier ? `<div class="patient-courier-card"><span class="icon-tile">${Ui.icon("bike")}</span><div><small>Курьер</small><strong>${Format.escape(order.courierName)}</strong><span>${Format.escape([order.courierTransport, courierPhone].filter(Boolean).join(" · ") || "Контакт появится после назначения")}</span></div>${courierPhone ? `<a class="icon-button" href="tel:${Format.escape(courierPhone)}" title="Позвонить курьеру">${Ui.icon("phone")}</a>` : ""}</div>` : ""}
            </div>
            ${order.status === "Доставлен" && order.deliveryPhotoData ? `<div class="delivery-proof-card"><img src="${Format.escape(order.deliveryPhotoData)}" alt="Фото подтверждения доставки" /><div><span class="status ok">${Ui.icon("check-circle")} Доставка подтверждена</span><h3>Фото вручения заказа</h3><p class="muted">${order.deliveredAt ? new Date(order.deliveredAt).toLocaleString("ru-RU") : "Заказ успешно передан клиенту."}</p></div></div>` : ""}
            ${order.status === "Доставлен" ? `
              <form class="patient-review-card" data-patient-review-form>
                <input type="hidden" name="orderId" value="${Format.escape(order.id)}" />
                <div class="patient-review-head">
                  <span class="icon-tile">${Ui.icon("star")}</span>
                  <div>
                    <h3>${review ? "Ваш отзыв о заказе" : "Оцените заказ"}</h3>
                    <p class="muted">${review ? `Обновлен ${Format.escape(Format.dateTime(review.updatedAt || review.createdAt || new Date()))}` : "Оценка попадет в кабинет аптеки и поможет ей улучшить сервис."}</p>
                  </div>
                </div>
                <div class="rating-picker" role="radiogroup" aria-label="Оценка заказа">
                  ${[1, 2, 3, 4, 5].map((value) => `<label class="${value === reviewRating ? "active" : ""}"><input type="radio" name="rating" value="${value}" ${value === reviewRating ? "checked" : ""} /><span>${value} ★</span></label>`).join("")}
                </div>
                <label class="field"><span>Комментарий</span><textarea name="text" required minlength="4" maxlength="500" placeholder="Например: быстро собрали заказ, цена совпала, курьер приехал вовремя.">${Format.escape(review?.text || "")}</textarea></label>
                ${pharmacyReviewResponse ? `<div class="patient-review-response"><strong>${Ui.icon("message-circle")} Ответ аптеки</strong><p>${Format.escape(pharmacyReviewResponse.response || "")}</p><small>${Format.escape(Format.dateTime(pharmacyReviewResponse.updatedAt || new Date()))}</small></div>` : ""}
                <button class="btn primary" type="submit">${Ui.icon("check-circle")} ${review ? "Обновить отзыв" : "Отправить отзыв"}</button>
              </form>
            ` : ""}
            <div class="order-google-map">
              ${Ui.mapSurface({
                latitude: orderMapCenter.latitude,
                longitude: orderMapCenter.longitude,
                zoom: 12,
                className: "order-route-surface",
                label: "Маршрут заказа от аптеки до клиента",
                route: true,
                markers: [
                  { latitude: order.pharmacyLatitude, longitude: order.pharmacyLongitude, type: "pharmacy", icon: "hospital", label: order.pharmacyName, active: true },
                  { latitude: orderClientLocation.latitude, longitude: orderClientLocation.longitude, type: "client", icon: "map-pin", label: order.address || "Клиент" },
                ],
              })}
              <div class="order-map-overlay">
                <div><small>Аптека</small><strong>${Format.escape(order.pharmacyName)}</strong><span>${Format.escape(order.pharmacyAddress || "")}</span></div>
                <div><small>${order.type === "Самовывоз" ? "Получение" : "Адрес доставки"}</small><strong>${Format.escape(order.type)}</strong><span>${Format.escape(order.address || "")}</span></div>
                <a class="btn primary" href="${Format.escape(directionsUrl)}" target="_blank" rel="noopener">${Ui.icon("navigation")} Маршрут в Google Maps</a>
              </div>
            </div>
            <div class="detail-grid">
              <div class="panel" style="padding: 18px;">
                <h3>Детали заказа</h3>
                ${this.fact("hospital", "Аптека", Format.escape(order.pharmacyName))}
                ${this.fact("map-pin", order.type === "Самовывоз" ? "Адрес самовывоза" : "Адрес доставки", Format.escape(order.type === "Самовывоз" ? order.pharmacyAddress : order.address))}
                ${this.fact("clock", "Ориентировочное время", `${Number(order.duration) || 0} мин`)}
                ${this.fact("credit-card", "Способ оплаты", Format.escape(order.payment || "Не указан"))}
              </div>
              <div class="panel order-lines" style="padding: 18px;">
                <div class="panel-head" style="padding:0 0 12px; min-height:auto;"><h3>Товары в заказе (${order.itemCount || 0})</h3></div>
                ${(order.items || []).map((item) => {
                  const quantity = Math.max(1, Number(item.quantity) || 1);
                  const lineTotal = Number(item.price || 0) * quantity;
                  return `<div class="mini-product">${Ui.packshot(item, "small")}<span><strong>${Format.escape(item.name)}</strong><br /><span class="muted">${Format.escape(item.subtitle || "")} · ${quantity} уп. · ${Format.money(item.price)} за уп.</span></span><strong>${Format.money(lineTotal)}</strong></div>`;
                }).join("")}
              </div>
            </div>
          </section>
          <aside class="side-stack">
            <div class="order-aside-card panel">
              <div class="panel-head" style="padding:0 0 18px; min-height:auto;"><h3>Итог заказа</h3><span class="icon-tile">${Ui.icon("receipt-text")}</span></div>
              <p>Товары (${order.itemCount || 0}) <strong style="float:right;">${Format.money(Number(order.amount) - Number(order.deliveryFee || 0))}</strong></p>
              <p>Доставка <strong style="float:right;">${Format.money(order.deliveryFee || 0)}</strong></p>
              <hr style="border:0; border-top:1px solid var(--line); margin: 18px 0;" />
              <div class="buy-price">Итого <span style="float:right;">${Format.money(order.amount)}</span></div>
              <button class="btn primary" style="width:100%; margin-top:22px;" type="button" data-patient-repeat="${Format.escape(order.id)}">${Ui.icon("refresh-cw")} Повторить заказ</button>
              <a class="btn ghost" style="width:100%; margin-top:10px;" href="#search">${Ui.icon("search")} Новый заказ</a>
            </div>
            ${Number(order.offerScore) ? `
              <div class="order-aside-card panel order-trust-card">
                <div class="checkout-score-head">
                  <span class="dorigo-score large">${Number(order.offerScore)}</span>
                  <div>
                    <h3>Почему эта аптека</h3>
                    <p class="muted">Выбор был сохранен в момент оформления заказа.</p>
                  </div>
                </div>
                <ul class="checkout-guarantee-list">
                  ${(order.offerAdvantages || []).map((reason) => `<li>${Ui.icon("check-circle")} ${Format.escape(reason)}</li>`).join("")}
                  <li>${Ui.icon("package-check")} Зарезервировано ${Number(order.reservedQuantity || order.itemCount || 1)} уп., после заказа осталось ${Number(order.availableAfterOrder || 0)} уп.</li>
                  <li>${Ui.icon("map-pin")} ${order.distance !== null && order.distance !== undefined ? `${Number(order.distance).toFixed(1)} км от клиента` : "маршрут сохранен по координатам"}</li>
                </ul>
              </div>
            ` : ""}
            ${Ui.orderChat(order, "patient")}
            ${Ui.orderHistory(order, "patient")}
            <div class="order-aside-card panel">
              <div class="panel-head" style="padding:0 0 18px; min-height:auto;"><h3>История заказов</h3></div>
              ${history.map((item) => `<button class="patient-order-link ${item.id === order.id ? "active" : ""}" type="button" data-patient-order="${Format.escape(item.id)}"><span><strong>#${Format.escape(item.id)}</strong><small>${new Date(item.createdAt || item.date).toLocaleDateString("ru-RU")} · ${Format.money(item.amount)}</small></span><span class="status ${Ui.statusClass(item.status)}">${Format.escape(item.status)}</span></button>`).join("")}
            </div>
          </aside>
        </main>
        ${Ui.footer()}
      </div>
    `;
  }

  checkout() {
    const user = this.store.accounts.currentUser();
    const selected = this.store.selectedOffer();
    const product = this.store.productById(this.store.selectedProductId);
    const pharmacy = selected.pharmacy;
    const paymentOptions = [
      pharmacy.payments?.cash !== false ? "Наличные" : null,
      pharmacy.payments?.card !== false ? "Карта при получении" : null,
      pharmacy.payments?.click !== false ? "Click" : null,
      pharmacy.payments?.payme !== false ? "Payme" : null,
    ].filter(Boolean);
    const customerLocation = this.store.customerLocation;
    const initialQuantity = Math.max(1, Math.min(Number(selected.available) || 1, Number(this.store.checkoutQuantity) || 1));
    const defaultDelivery = Boolean(selected.deliveryAvailable);
    const initialProductsTotal = selected.price * initialQuantity;
    const initialDeliveryFee = defaultDelivery ? selected.deliveryFee : 0;
    const initialTotal = initialProductsTotal + initialDeliveryFee;
    const remainingAfterReserve = Math.max(0, selected.available - initialQuantity);
    const reserveLabel = remainingAfterReserve > 0 ? `${remainingAfterReserve} уп. останется в аптеке` : "резервируем последнюю упаковку";
    const freshLabel = selected.hoursFresh === null
      ? "время обновления не указано"
      : selected.hoursFresh <= 1
        ? "остатки обновлены меньше часа назад"
        : selected.hoursFresh <= 24
          ? `остатки обновлены ${selected.hoursFresh} ч назад`
          : `остатки обновлены ${Math.round(selected.hoursFresh / 24)} дн. назад`;
    const assuranceReasons = (selected.advantages || []).length
      ? selected.advantages
      : [
        selected.available > 0 ? `${selected.available} шт. доступно` : "наличие уточняется",
        selected.distance !== null ? `${selected.distance.toFixed(1)} км от вас` : "нужна точка доставки",
        defaultDelivery ? `доставка около ${selected.deliveryMinutes} мин` : "самовывоз из аптеки",
      ];
    const checkoutMapCenter = {
      latitude: (Number(pharmacy.latitude) + Number(customerLocation.latitude)) / 2,
      longitude: (Number(pharmacy.longitude) + Number(customerLocation.longitude)) / 2,
    };
    return `
      <div class="page checkout-page">
        ${Ui.publicHeader(user)}
        <main class="container checkout-layout">
          <form class="panel checkout-form" data-checkout-form>
            <div class="breadcrumb"><a href="#product">Выбор аптеки</a><span>></span><span>Оформление заказа</span></div>
            <div class="page-title">
              <div><span class="geo-pill">${Ui.icon("shield-check")} Безопасное оформление</span><h1>Проверьте заказ</h1><p>Цена и наличие зафиксированы у выбранной аптеки.</p></div>
              <button class="btn ghost" type="button" data-checkout-back>${Ui.icon("chevron-left")} Другая аптека</button>
            </div>

            <section class="checkout-pharmacy">
              <span class="mini-logo">${pharmacy.logoData ? `<img src="${Format.escape(pharmacy.logoData)}" alt="" />` : Ui.icon("cross")}</span>
              <div><small>Выбранная аптека</small><h3>${Format.escape(pharmacy.name)}</h3><p>${Format.escape(pharmacy.address || "")}</p></div>
              <a href="${Format.escape(selected.directionsUrl)}" target="_blank" rel="noopener">${Ui.icon("navigation")} ${selected.distance === null ? "Маршрут" : `${selected.distance.toFixed(1)} км`}</a>
            </section>

            <section class="checkout-product">
              ${Ui.packshot(product, "small")}
              <div><strong>${Format.escape(product.name)}</strong><p class="muted">${Format.escape(product.subtitle || "")}</p><span class="status ok">В наличии: ${selected.available} шт.</span></div>
              <div class="checkout-product-side">
                <strong>${Format.money(selected.price)}</strong>
                <label class="quantity-stepper checkout-quantity">
                  <span>Количество</span>
                  <div>
                    <button type="button" data-checkout-quantity-step="-1" aria-label="Уменьшить количество">${Ui.icon("minus")}</button>
                    <input name="quantity" data-checkout-quantity type="number" min="1" max="${selected.available}" value="${initialQuantity}" inputmode="numeric" />
                    <button type="button" data-checkout-quantity-step="1" aria-label="Увеличить количество">${Ui.icon("plus")}</button>
                  </div>
                  <small>Доступно ${selected.available} уп.</small>
                </label>
              </div>
            </section>

            <div class="checkout-fields">
              <label>Способ получения
                <select name="type" data-checkout-type>
                  ${selected.deliveryAvailable ? `<option value="Доставка">Доставка · около ${selected.deliveryMinutes} мин</option>` : ""}
                  ${selected.pickupAvailable ? '<option value="Самовывоз">Самовывоз из аптеки</option>' : ""}
                </select>
              </label>
              <label>Способ оплаты
                <select name="payment">${paymentOptions.map((option) => `<option>${Format.escape(option)}</option>`).join("")}</select>
              </label>
              <label class="checkout-address" data-checkout-address>Адрес доставки
                <input name="address" value="${Format.escape(user.address || "")}" placeholder="Ташкент, улица, дом, квартира" required />
              </label>
            </div>
            <div class="location-inline">
              <span>${Ui.icon("map-pin")} ${Format.escape(this.store.customerLocation.label)}</span>
              <button class="link-more" type="button" data-customer-location>Уточнить геолокацию</button>
            </div>
            <button class="btn primary checkout-submit" type="submit" data-checkout-submit>${Ui.icon("check-circle")} Подтвердить заказ на ${Format.money(initialTotal)}</button>
          </form>

          <aside class="side-stack">
            <div class="panel checkout-assurance">
              <div class="checkout-score-head">
                <span class="dorigo-score large">${selected.qualityScore}</span>
                <div>
                  <h3>DoriGo проверил выбор</h3>
                  <p class="muted">Цена, наличие, расстояние и доставка сверены перед оформлением.</p>
                </div>
              </div>
              <div class="checkout-assurance-grid">
                <div><small>Резерв</small><strong data-checkout-reserve-left>${reserveLabel}</strong></div>
                <div><small>Остатки</small><strong>${Format.escape(freshLabel)}</strong></div>
                <div><small>Получение</small><strong data-checkout-mode-label>${defaultDelivery ? `доставка около ${selected.deliveryMinutes} мин` : "самовывоз"}</strong></div>
                <div><small>Аптека</small><strong>${selected.trustScore}% доверия</strong></div>
              </div>
              <ul class="checkout-guarantee-list">
                ${assuranceReasons.map((reason) => `<li>${Ui.icon("check-circle")} ${Format.escape(reason)}</li>`).join("")}
                <li>${Ui.icon("receipt-text")} Итоговая сумма фиксируется в заказе</li>
              </ul>
            </div>
            <div class="pharmacy-map-card side-card">
              <div class="panel-head"><h3>Аптека на Google Maps</h3><span class="icon-tile">${Ui.icon("map-pin")}</span></div>
              ${Ui.mapSurface({
                latitude: checkoutMapCenter.latitude,
                longitude: checkoutMapCenter.longitude,
                zoom: 12,
                className: "side-map-surface",
                label: "Маршрут от выбранной аптеки до клиента",
                route: true,
                markers: [
                  { latitude: pharmacy.latitude, longitude: pharmacy.longitude, type: "pharmacy", icon: "hospital", label: pharmacy.name, active: true },
                  { latitude: customerLocation.latitude, longitude: customerLocation.longitude, type: "client", icon: "map-pin", label: customerLocation.label },
                ],
              })}
              <a class="btn ghost" href="${Format.escape(selected.directionsUrl)}" target="_blank" rel="noopener">${Ui.icon("navigation")} Построить маршрут</a>
            </div>
            <div class="panel checkout-summary">
              <h3>Итого</h3>
              <p><span data-checkout-product-label>Товар x ${initialQuantity}</span><strong data-checkout-products-total>${Format.money(initialProductsTotal)}</strong></p>
              <p><span>Доставка</span><strong data-checkout-delivery>${initialDeliveryFee ? Format.money(initialDeliveryFee) : "Бесплатно"}</strong></p>
              <hr />
              <p class="total"><span>К оплате</span><strong data-checkout-total>${Format.money(initialTotal)}</strong></p>
              <small>После подтверждения заказ сразу появится у аптеки.</small>
            </div>
          </aside>
        </main>
        ${Ui.footer()}
      </div>
    `;
  }
}

class DashboardViews {
  constructor(store) {
    this.store = store;
  }

  layout(kind, content) {
    const isAdmin = kind.startsWith("admin");
    const pharmacy = this.store.accounts.activePharmacy();
    const planUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString("ru-RU");
    return `
      <div class="dashboard-layout">
        <aside class="sidebar">
          ${Ui.brand()}
          ${isAdmin ? "" : `<div class="side-profile"><span class="avatar">${Format.escape((pharmacy?.name || "A").charAt(0))}</span><div><strong>${Format.escape(pharmacy?.name || "Аптека")}</strong><p class="muted">${Format.escape(pharmacy?.city || "Ташкент")}, ${Format.escape(pharmacy?.district || "")}</p></div></div>`}
          <nav class="side-nav">
            ${this.sideLink("layout-dashboard", "Дашборд", isAdmin ? "#admin" : "#partner", kind === "admin" || kind === "partner")}
            ${isAdmin ? this.adminLinks(kind) : this.partnerLinks(kind)}
          </nav>
          <div class="side-spacer"></div>
          <div class="support-card"><span class="icon-tile">${Ui.icon("messages-square")}</span><h4>Нужна помощь?</h4><p class="muted">Мы всегда на связи и готовы помочь вам</p><a class="btn primary" style="width:100%;" href="#partner-support">Написать в поддержку</a></div>
          ${isAdmin ? `<div class="support-card"><h4>Система</h4><p class="muted">Все системы работают</p><div class="trend">99.9%</div></div>` : `<div class="plan-card"><h4>Ваш тариф</h4><strong>Стандартный</strong><p class="muted">Действует до ${planUntil}</p><div style="height:8px;background:var(--line);border-radius:8px;"><div style="width:80%;height:8px;background:var(--green);border-radius:8px;"></div></div></div>`}
        </aside>
        <main class="dashboard-main">
          ${this.topbar(isAdmin)}
          <div class="dashboard-content">${content}</div>
        </main>
      </div>
    `;
  }

  sideLink(icon, text, href, active = false) {
    return `<a class="${active ? "active" : ""}" href="${href}">${Ui.icon(icon)} ${text}</a>`;
  }

  partnerLinks(kind) {
    return [
      this.sideLink("clipboard-list", "Заказы", "#partner-orders", kind === "partner-orders" || kind === "partner-order"),
      this.sideLink("shopping-bag", "Товары и остатки", "#inventory", kind === "inventory"),
      this.sideLink("tag", "Цены и акции", "#partner-pricing", kind === "pricing"),
      this.sideLink("shapes", "Категории", "#partner-categories", kind === "categories"),
      this.sideLink("chart-no-axes-column", "Аналитика", "#partner-analytics", kind === "analytics"),
      this.sideLink("circle-help", "Поддержка", "#partner-support", kind === "support"),
      this.sideLink("settings", "Настройки", "#partner-settings", kind === "settings"),
    ].join("");
  }

  adminLinks(kind) {
    return [
      this.sideLink("hospital", "Аптеки", "#admin", kind === "admin"),
      this.sideLink("shopping-bag", "Каталог препаратов", "#admin-catalog", kind === "admin-catalog"),
      this.sideLink("clipboard-list", "Заказы", "#admin"),
      this.sideLink("bike", "Курьеры", "#admin"),
      this.sideLink("badge-alert", "Жалобы", "#admin"),
      this.sideLink("coins", "Комиссии", "#admin"),
      this.sideLink("undo-2", "Возвраты", "#admin"),
      this.sideLink("shield-alert", "Модерация", "#admin"),
      this.sideLink("ban", "Запрещенные категории", "#admin"),
      this.sideLink("settings", "Настройки", "#admin"),
    ].join("");
  }

  topbar(isAdmin) {
    const account = this.store.accounts.currentUser();
    const pharmacies = this.store.accounts.pharmacies();
    const activePharmacy = this.store.accounts.activePharmacy();
    const userName = isAdmin ? "Александр" : (account?.name || activePharmacy?.manager || "Управляющий");
    const initials = userName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "AA";
    const notificationCount = isAdmin
      ? (() => {
          const admin = this.store.adminStats();
          return admin.needsModeration + admin.lowStock + admin.outOfStock + admin.stats.new + admin.stats.confirmed;
        })()
      : (() => {
          const orders = this.store.orderStats();
          const inventory = this.store.inventoryStats();
          return orders.new + orders.confirmed + orders.assembly + inventory.lowStock + inventory.outOfStock;
        })();
    return `
      <header class="dash-top">
        ${isAdmin ? `<select class="select-pill"><option>Все регионы</option></select>` : `
          <select class="select-pill" data-pharmacy-select>
            ${pharmacies.map((pharmacy) => `<option value="${Format.escape(pharmacy.id)}" ${pharmacy.id === activePharmacy?.id ? "selected" : ""}>${Format.escape(pharmacy.name)}</option>`).join("")}
          </select>
        `}
        <div class="field has-icon">${Ui.icon("search")}<input type="search" data-dashboard-search placeholder="Поиск по заказам, товарам, клиентам..." /></div>
        <div class="top-user">
          <span class="bell" role="button" tabindex="0" data-dashboard-bell data-count="${notificationCount}" aria-label="Открыть важные задачи">${Ui.icon("bell")}</span>
          <span class="avatar">${Format.escape(initials)}</span>
          <div class="top-user-copy">
            <strong>${Format.escape(userName)}</strong>
            <p class="muted">${isAdmin ? "Администратор" : (account?.type === "pharmacy" ? "Владелец сети" : "Управляющий")}</p>
          </div>
          <button class="top-logout" type="button" data-auth-logout title="Выйти из аккаунта" aria-label="Выйти из аккаунта">${Ui.icon("log-out")}</button>
        </div>
      </header>
    `;
  }

  partnerDashboard() {
    const inventoryStats = this.store.inventoryStats();
    const stats = this.store.orderStats();
    const todayStats = this.store.orderStats(this.store.analyticsOrders("1"));
    const actionCount = stats.new + stats.confirmed + stats.assembly;
    const content = `
      <section class="page-title">
        <div><h1>Дашборд аптеки</h1><p>Обзор ключевых показателей и текущих задач на сегодня.</p></div>
        <div class="button-row"><button class="btn primary" data-product-add>${Ui.icon("plus")} Добавить товар</button><button class="btn ghost" data-excel-upload>${Ui.icon("file-spreadsheet")} Загрузить Excel</button><button class="btn ghost" data-inventory-export>${Ui.icon("download")} Скачать прайс</button><button class="btn ghost" data-inventory-refresh>${Ui.icon("refresh-cw")} Обновить остатки</button></div>
      </section>
      <section class="metric-grid">
        ${this.metric("shopping-bag", "Заказы сегодня", String(todayStats.total), "По данным заказов")}
        ${this.metric("banknote", "Сумма заказов сегодня", Format.money(todayStats.activeRevenue), "Без отмененных", "orange")}
        ${this.metric("clock", "Требуют действий", String(actionCount), `На сумму ${Format.money(stats.newAmount + stats.confirmedAmount + stats.assemblyAmount)}`, "purple")}
        ${this.metric("clock", "Среднее время сборки", `${stats.averageAssembly} мин`, `${stats.completed} завершенных заказов`, "purple")}
        ${this.metric("triangle-alert", "Низкие остатки", String(inventoryStats.lowStock), "товаров", "red")}
      </section>
      <section class="dashboard-grid">
        <div class="panel wide">
          <div class="panel-head"><h3>Заказы, требующие действий <span class="badge warn">${actionCount}</span></h3><a class="link-more" href="#partner-orders">Смотреть все</a></div>
          ${this.ordersTable(5)}
        </div>
        ${this.lowStockPanel()}
      </section>
      <section class="dashboard-grid">
        ${this.revenuePanel()}
        ${this.deliveryStatusPanel()}
        ${this.popularPanel()}
      </section>
      <section class="partner-actions">
        <button class="quick-card" data-product-add><span class="icon-tile">${Ui.icon("plus")}</span><div><strong>Добавить товар</strong><p class="muted">Ручное добавление через общий каталог</p></div></button>
        <button class="quick-card" data-excel-upload>${Ui.icon("file-spreadsheet")}<div><strong>Загрузить Excel</strong><p class="muted">Массовое обновление цен и остатков</p></div></button>
        <button class="quick-card" data-inventory-refresh>${Ui.icon("refresh-cw")}<div><strong>Обновить остатки</strong><p class="muted">Пересчитать доступность и обновить витрину</p></div></button>
        <a class="quick-card" href="#partner-pricing"><span class="icon-tile">${Ui.icon("tag")}</span><div><strong>Управление ценами</strong><p class="muted">Массовые изменения и история</p></div></a>
        <a class="quick-card" href="#partner-support"><span class="icon-tile">${Ui.icon("headphones")}</span><div><strong>Написать в поддержку</strong><p class="muted">Отзывы, жалобы и чат</p></div></a>
      </section>
    `;
    return this.layout("partner", content);
  }

  inventory(state = {}) {
    const stats = this.store.inventoryStats();
    const filters = {
      query: state.query || "",
      category: state.category || "",
      status: state.status || "all",
      expiry: state.expiry || "all",
      page: Math.max(1, Number(state.page) || 1),
      pageSize: Math.max(10, Number(state.pageSize) || 20),
    };
    const query = this.store.normalizeLookup(filters.query);
    const categories = Array.from(new Set([
      ...this.store.categories.map((category) => category.name),
      ...this.store.pharmacyInventory.map((product) => product.category),
    ].filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
    const expiryStatus = (product) => {
      const normalized = Format.expiryInput(product.expiry);
      if (!normalized) return "missing";
      const [year, month] = normalized.split("-").map(Number);
      const expiresAt = new Date(year, month, 0, 23, 59, 59);
      const today = new Date();
      const soon = new Date();
      soon.setDate(soon.getDate() + 120);
      if (expiresAt < today) return "expired";
      if (expiresAt <= soon) return "soon";
      return "valid";
    };
    const matchesStatus = (product) => {
      const available = Math.max(0, Number(product.stock) - Number(product.reserve || 0));
      const published = product.published !== false;
      if (filters.status === "published") return published;
      if (filters.status === "hidden") return !published;
      if (filters.status === "inStock") return published && available > 0;
      if (filters.status === "low") return published && available > 0 && available <= 7;
      if (filters.status === "out") return available < 1;
      return true;
    };
    const products = this.store.pharmacyInventory.filter((product) => {
      const haystack = this.store.normalizeLookup([
        product.name,
        product.subtitle,
        product.mnn,
        product.ingredient,
        product.barcode,
        product.manufacturer,
      ].join(" "));
      const matchesQuery = !query || haystack.includes(query);
      const matchesCategory = !filters.category || product.category === filters.category;
      const matchesExpiry = filters.expiry === "all" || expiryStatus(product) === filters.expiry;
      return matchesQuery && matchesCategory && matchesStatus(product) && matchesExpiry;
    });
    const pageSize = filters.pageSize;
    const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
    const currentPage = Math.min(filters.page, totalPages);
    const pageStart = (currentPage - 1) * pageSize;
    const visibleProducts = products.slice(pageStart, pageStart + pageSize);
    const shownFrom = products.length ? pageStart + 1 : 0;
    const shownTo = Math.min(pageStart + pageSize, products.length);
    const paginationItems = [...new Set([
      1,
      currentPage - 1,
      currentPage,
      currentPage + 1,
      totalPages,
    ].filter((page) => page >= 1 && page <= totalPages))].sort((a, b) => a - b);
    const paginationMarkup = paginationItems.map((page, index) => {
      const previousPage = paginationItems[index - 1];
      const gap = previousPage && page - previousPage > 1 ? `<span class="pagination-gap" aria-hidden="true">...</span>` : "";
      return `${gap}<button type="button" data-inventory-page="${page}" class="${page === currentPage ? "active" : ""}" ${page === currentPage ? 'aria-current="page"' : ""}>${page}</button>`;
    }).join("");
    const titleCount = products.length === stats.total ? String(stats.total) : `${products.length} из ${stats.total}`;
    const percent = (value) => stats.total ? `${Math.round((value / stats.total) * 100)}% от общего` : "Склад пока пуст";
    const content = `
      <section class="page-title">
        <div><h1>Товары и остатки</h1><p>Управляйте ассортиментом, ценами и остатками товаров в вашей аптеке.</p></div>
        <div class="button-row"><button class="btn primary" data-product-add>${Ui.icon("plus")} Добавить товар</button><button class="btn ghost" data-excel-upload>${Ui.icon("file-spreadsheet")} Загрузить Excel</button><button class="btn ghost" data-inventory-refresh>${Ui.icon("refresh-cw")} Обновить остатки</button></div>
      </section>
      <section class="metric-grid" style="grid-template-columns: repeat(4, minmax(0, 1fr));">
        ${this.metric("package-check", "Всего позиций", String(stats.total), stats.total ? "Товары вашей аптеки" : "Добавьте первый товар")}
        ${this.metric("check-circle", "В наличии", String(stats.inStock), percent(stats.inStock))}
        ${this.metric("triangle-alert", "Мало остатка", String(stats.lowStock), percent(stats.lowStock), "orange")}
        ${this.metric("circle-x", "Нет в наличии", String(stats.outOfStock), percent(stats.outOfStock), "red")}
      </section>
      <section class="panel excel-import-guide">
        <div>
          <span class="icon-tile">${Ui.icon("file-spreadsheet")}</span>
          <div>
            <h3>Массовая загрузка через Excel</h3>
            <p class="muted">Файл обновляет только цену, остаток, срок годности и штрихкод предложения аптеки. Для товаров с остатком срок годности обязателен, а колонка ID DoriGo помогает точно обновлять нужную карточку без дубликатов.</p>
          </div>
        </div>
        <div class="excel-columns">
          ${["ID DoriGo", "Название", "МНН", "Дозировка", "Форма", "Цена", "Остаток", "Срок годности", "Штрихкод"].map((column) => `<span>${column}</span>`).join("")}
        </div>
        <div class="excel-preflight">
          <article><strong>${Ui.icon("database")} ID DoriGo</strong><span>Самый надежный способ сопоставить строку с единой карточкой препарата.</span></article>
          <article><strong>${Ui.icon("calendar-check")} Срок годности</strong><span>Для строк с остатком больше 0 месяц и год обязательны.</span></article>
          <article><strong>${Ui.icon("shield-check")} Без дублей</strong><span>Одинаковые ID, дозировка и упаковка в одном файле будут остановлены до публикации.</span></article>
          <article><strong>${Ui.icon("file-check")} Формат файла</strong><span>Поддерживаются .xlsx, .xls, .csv и .tsv до 8 МБ.</span></article>
        </div>
        <div class="button-row">
          <button class="btn ghost" type="button" data-excel-template>${Ui.icon("download")} Скачать шаблон</button>
          <button class="btn ghost" type="button" data-catalog-reference>${Ui.icon("database")} Справочник ID</button>
          <button class="btn ghost" type="button" data-inventory-export>${Ui.icon("file-down")} Скачать текущий прайс</button>
          <button class="btn primary" type="button" data-excel-upload>${Ui.icon("upload")} Загрузить заполненный файл</button>
        </div>
      </section>
      <div class="filters-line">
        <div class="field has-icon">${Ui.icon("search")}<input type="search" value="${Format.escape(filters.query)}" data-inventory-query placeholder="Поиск по названию, МНН или штрихкоду..." /></div>
        <select class="select-pill" data-inventory-category>
          <option value="">Все категории</option>
          ${categories.map((category) => `<option value="${Format.escape(category)}" ${filters.category === category ? "selected" : ""}>${Format.escape(category)}</option>`).join("")}
        </select>
        <select class="select-pill" data-inventory-status>
          <option value="all" ${filters.status === "all" ? "selected" : ""}>Все статусы</option>
          <option value="published" ${filters.status === "published" ? "selected" : ""}>Опубликованы</option>
          <option value="hidden" ${filters.status === "hidden" ? "selected" : ""}>Скрыты</option>
          <option value="inStock" ${filters.status === "inStock" ? "selected" : ""}>В наличии</option>
          <option value="low" ${filters.status === "low" ? "selected" : ""}>Мало остатка</option>
          <option value="out" ${filters.status === "out" ? "selected" : ""}>Нет в наличии</option>
        </select>
        <select class="select-pill" data-inventory-expiry>
          <option value="all" ${filters.expiry === "all" ? "selected" : ""}>Любой срок годности</option>
          <option value="soon" ${filters.expiry === "soon" ? "selected" : ""}>Скоро истекает</option>
          <option value="expired" ${filters.expiry === "expired" ? "selected" : ""}>Просрочено</option>
          <option value="missing" ${filters.expiry === "missing" ? "selected" : ""}>Срок не указан</option>
        </select>
        <button class="btn ghost" type="button" data-inventory-reset>${Ui.icon("rotate-ccw")} Сбросить</button>
      </div>
      <section class="panel">
        <div class="panel-head"><h3>Товары (${titleCount})</h3><span class="status ok">Синхронизировано с витриной</span></div>
        ${this.productsTable(visibleProducts, stats.total > 0)}
        ${products.length > pageSize ? `
          <div class="catalog-pagination-wrap order-pagination inventory-pagination">
            <p class="pagination-summary">Показано ${shownFrom}-${shownTo} из ${products.length}</p>
            <nav class="pagination" aria-label="Страницы склада">
              <button type="button" data-inventory-page="${currentPage - 1}" aria-label="Предыдущая страница" ${currentPage === 1 ? "disabled" : ""}>${Ui.icon("chevron-left")}</button>
              ${paginationMarkup}
              <button type="button" data-inventory-page="${currentPage + 1}" aria-label="Следующая страница" ${currentPage === totalPages ? "disabled" : ""}>${Ui.icon("chevron-right")}</button>
            </nav>
            <label class="page-size-control">Показывать по:<select class="select-pill" data-inventory-page-size><option value="20" ${pageSize === 20 ? "selected" : ""}>20</option><option value="50" ${pageSize === 50 ? "selected" : ""}>50</option><option value="100" ${pageSize === 100 ? "selected" : ""}>100</option></select></label>
          </div>
        ` : ""}
      </section>
      <section class="inventory-panels">
        ${this.lowStockPanel(true)}
        ${this.syncPanel()}
      </section>
      <section class="partner-actions">
        <article class="quick-card"><span class="icon-tile">${Ui.icon("search")}</span><div><strong>1. Найти в общем каталоге</strong><p class="muted">Аптека подключается к существующей карточке товара, чтобы не создавать дубликаты.</p></div></article>
        <article class="quick-card"><span class="icon-tile">${Ui.icon("tag")}</span><div><strong>2. Указать цену и остаток</strong><p class="muted">Предложение аптеки хранит цену, остаток, резерв и доступность.</p></div></article>
        <article class="quick-card"><span class="icon-tile">${Ui.icon("shield-alert")}</span><div><strong>3. Нет карточки — нет публикации</strong><p class="muted">Позиция без совпадения с единым каталогом не попадает на витрину.</p></div></article>
      </section>
    `;
    return this.layout("inventory", content);
  }

  partnerOrdersPage(state = {}) {
    const currentState = {
      tab: state.tab || "Все",
      query: state.query || "",
      dateFrom: state.dateFrom || "",
      dateTo: state.dateTo || "",
      type: state.type || "all",
      sort: state.sort || "newest",
      page: Math.max(1, Number(state.page) || 1),
      pageSize: Math.max(5, Number(state.pageSize) || 10),
    };
    const orders = this.store.filterOrders(currentState);
    const stats = this.store.orderStats();
    const automation = this.store.orderAutomationSettings();
    const periodEnd = new Date();
    const periodStart = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const orderPeriod = `${periodStart.toLocaleDateString("ru-RU")} - ${periodEnd.toLocaleDateString("ru-RU")}`;
    const tabs = ["Все", "Новые", "Подтвердить", "Сборка", "Доставка", "Завершенные"];
    const statusRows = [
      ["Новые", stats.new, "ok"],
      ["Нужно подтвердить", stats.confirmed, "warn"],
      ["В сборке", stats.assembly, "purple"],
      ["Переданы курьеру", stats.courier, "blue"],
      ["Доставлены", stats.completed, "ok"],
      ["Отменены", stats.cancelled, "danger"],
    ];
    const content = `
      <section class="page-title">
        <div><h1>Заказы</h1><p>Управляйте входящими заказами, подтверждайте наличие и отслеживайте выполнение.</p></div>
      </section>
      <section class="metric-grid" style="grid-template-columns: repeat(4, minmax(0, 1fr));">
        ${this.metric("shopping-bag", "Новые заказы", String(stats.new), `На сумму ${Format.money(stats.newAmount)}`)}
        ${this.metric("clock", "Нужно подтвердить", String(stats.confirmed), `На сумму ${Format.money(stats.confirmedAmount)}`, "orange")}
        ${this.metric("package", "В сборке", String(stats.assembly), `На сумму ${Format.money(stats.assemblyAmount)}`, "purple")}
        ${this.metric("truck", "Передано курьеру", String(stats.courier), `На сумму ${Format.money(stats.courierAmount)}`, "blue")}
      </section>
      <section class="panel">
        <div class="partner-tabs">${tabs.map((tab) => `<button class="${currentState.tab === tab ? "active" : ""}" data-order-tab="${tab}">${tab}</button>`).join("")}</div>
        <div class="filters-line partner-order-filters">
          <span class="date-pill">${Ui.icon("calendar")} ${orderPeriod}</span>
          <div class="field has-icon">${Ui.icon("search")}<input type="search" value="${Format.escape(currentState.query)}" data-order-search placeholder="Поиск по номеру заказа, клиенту, телефону..." /></div>
          <label class="field compact-field"><span>С</span><input type="date" value="${Format.escape(currentState.dateFrom)}" data-order-date-from /></label>
          <label class="field compact-field"><span>По</span><input type="date" value="${Format.escape(currentState.dateTo)}" data-order-date-to /></label>
          <select class="select-pill" data-order-type>
            <option value="all" ${currentState.type === "all" ? "selected" : ""}>Все типы</option>
            <option value="Доставка" ${currentState.type === "Доставка" ? "selected" : ""}>Доставка</option>
            <option value="Самовывоз" ${currentState.type === "Самовывоз" ? "selected" : ""}>Самовывоз</option>
          </select>
          <select class="select-pill" data-order-sort>
            <option value="newest" ${currentState.sort === "newest" ? "selected" : ""}>Сначала новые</option>
            <option value="oldest" ${currentState.sort === "oldest" ? "selected" : ""}>Сначала старые</option>
            <option value="amountDesc" ${currentState.sort === "amountDesc" ? "selected" : ""}>Сумма ↓</option>
            <option value="amountAsc" ${currentState.sort === "amountAsc" ? "selected" : ""}>Сумма ↑</option>
            <option value="status" ${currentState.sort === "status" ? "selected" : ""}>По статусу</option>
          </select>
          <button class="btn ghost" type="button" data-orders-export>${Ui.icon("download")} CSV</button>
          <button class="btn ghost" type="button" data-order-reset>${Ui.icon("rotate-ccw")} Сбросить</button>
        </div>
      </section>
      <section class="orders-page-grid">
        <div class="panel">${this.partnerOrdersFullTable(orders, currentState)}</div>
        <aside class="side-stack">
          <div class="panel side-card"><h3>Сводка заказов</h3><div class="metric-value">${stats.total}</div><p class="muted">Сумма активных заказов: ${Format.money(stats.activeRevenue)}</p><div class="status-list">${statusRows.map(([label, value, tone]) => `<div><span class="dot ${tone}"></span><span>${label}</span><strong>${value}</strong></div>`).join("")}</div></div>
          <div class="panel side-card"><h3>Среднее время сборки</h3><div class="metric-value">${stats.averageAssembly} мин</div><p class="muted">Рассчитано по ${stats.completed} доставленным заказам</p><div class="mini-spark"></div></div>
          <form class="panel side-card auto-confirm-card" data-auto-confirm-form>
            <span class="icon-tile">${Ui.icon("clipboard-check")}</span>
            <h3>Автоподтверждение заказов</h3>
            <label class="toggle-row"><span>Включить</span><input class="toggle-input" name="autoConfirm" type="checkbox" ${automation.autoConfirm ? "checked" : ""} /><span class="toggle"></span></label>
            <label class="settings-input"><span>Лимит суммы, сум</span><input name="limit" type="number" min="0" step="1000" value="${automation.limit}" /></label>
            <button class="btn primary" type="submit">${Ui.icon("save")} Сохранить</button>
            <p class="muted">${automation.autoConfirm ? `Активно до ${Format.money(automation.limit)}` : "Новые заказы требуют ручного подтверждения."}</p>
          </form>
        </aside>
      </section>
    `;
    return this.layout("partner-orders", content);
  }

  partnerOrderDetail() {
    const order = this.store.orders.find((item) => item.id === this.store.selectedOrderId) || this.store.orders[0];
    if (!order) {
      return this.layout("partner-order", `<div class="inventory-empty"><h2>Заказов пока нет</h2><a class="btn primary" href="#partner-orders">Вернуться к заказам</a></div>`);
    }
    const products = Array.isArray(order.items) ? order.items : [];
    const timeline = ["Новый", "Подтвержден", "Собирается", "Собран", "Передан курьеру", "В пути", "Доставлен"];
    const currentIndex = timeline.indexOf(order.status);
    const action = this.store.orderActionLabel(order.status);
    const checklistLocked = ["Собран", "Передан курьеру", "В пути", "Доставлен", "Отменен"].includes(order.status);
    const allItemsCollected = products.length ? products.every((product) => product.collected || checklistLocked) : true;
    const assemblyBlocked = order.status === "Собирается" && products.length > 0 && !allItemsCollected;
    const actionDisabled = assemblyBlocked ? 'disabled title="Сначала отметьте все позиции заказа"' : "";
    const courierOptions = this.store.courierRoster().map((courier) => {
      const label = `${courier.name} · ${courier.status} · ${courier.active} активн.`;
      return `<option value="${Format.escape(courier.name)}" ${order.courierName === courier.name ? "selected" : ""}>${Format.escape(label)}</option>`;
    }).join("");
    const itemRows = products.length
      ? products.map((product, index) => {
        const inventory = this.store.pharmacyInventory.find((item) => item.id === product.offerId || item.catalogId === product.productId);
        const stock = Number(inventory?.stock) || 0;
        const reserve = Number(inventory?.reserve) || 0;
        const collected = Boolean(product.collected) || checklistLocked;
        return `<div class="table-row order-items ${collected ? "collected" : ""}"><div class="product-cell">${Ui.packshot(product, "small")}<span><strong>${Format.escape(product.name)} ${Format.escape(product.subtitle || "")}</strong><br /><span class="muted">${Format.escape(product.category || order.category || "")}</span></span></div><strong>${product.quantity || 1} уп.</strong><span>${reserve} / ${stock}<br /><span class="status ${stock === 0 ? "danger" : stock < 6 ? "warn" : "ok"}">${stock === 0 ? "Нет в наличии" : stock < 6 ? "Мало" : "В наличии"}</span></span><label class="check-row"><input type="checkbox" data-order-item-collected="${Format.escape(order.id)}" data-item-index="${index}" ${collected ? "checked" : ""} ${checklistLocked ? "disabled" : ""} /></label></div>`;
      }).join("")
      : `<div class="table-row order-items"><div class="product-cell"><span class="icon-tile">${Ui.icon("package")}</span><span><strong>${Format.escape(order.productName || "Товары заказа")}</strong><br /><span class="muted">${Format.escape(order.category || "Без категории")}</span></span></div><strong>${order.itemCount || 1} поз.</strong><span>Исторический заказ</span><span class="status ${order.status === "Отменен" ? "danger" : "ok"}">${order.status === "Отменен" ? "Отменен" : "Учтен"}</span></div>`;
    const phoneHref = order.phone ? `tel:${String(order.phone).replace(/[^\d+]/g, "")}` : "";
    const callIconAction = phoneHref
      ? `<a class="icon-button" href="${Format.escape(phoneHref)}" aria-label="Позвонить клиенту">${Ui.icon("phone")}</a>`
      : `<button class="icon-button" type="button" disabled title="Телефон клиента не указан">${Ui.icon("phone")}</button>`;
    const callButtonAction = phoneHref
      ? `<a class="btn ghost" href="${Format.escape(phoneHref)}">${Ui.icon("phone")} Позвонить клиенту</a>`
      : `<button class="btn ghost" type="button" disabled>${Ui.icon("phone")} Телефон не указан</button>`;
    const content = `
      <section class="page-title">
        <div><p class="breadcrumb"><a href="#partner-orders">Заказы</a><span>></span><span>#${Format.escape(order.id)}</span></p><h1>Заказ #${Format.escape(order.id)} <span class="status ${Ui.statusClass(order.status)}">${Format.escape(order.status)}</span></h1><p>Создан ${Format.escape(order.date || "")} в ${Format.escape(order.time || "")}</p></div>
        ${action ? `<button class="btn primary" data-order-action="${Format.escape(order.id)}" ${actionDisabled}>${Ui.icon("refresh-cw")} ${action}</button>` : ""}
      </section>
      <div class="partner-order-detail">
        <main class="side-stack">
          ${order.status === "Отменен" ? `<section class="problem-banner">${Ui.icon("circle-x")} <strong>Заказ отменен</strong><span>Он исключен из выручки и активных показателей.</span></section>` : `<section class="panel order-progress">${timeline.map((step, index) => `<div class="${index < currentIndex ? "done" : index === currentIndex ? "active" : ""}"><span>${index < currentIndex ? Ui.icon("check") : index + 1}</span><strong>${step}</strong></div>`).join("")}</section>`}
          <section class="panel order-info-grid">
            <div><h4>Покупатель</h4><strong>${Format.escape(order.client)}</strong><p>${Format.escape(order.phone || "Телефон не указан")}</p><div class="button-row"><button class="icon-button" type="button" data-order-chat-focus="${Format.escape(order.id)}" aria-label="Написать клиенту">${Ui.icon("message-circle")}</button>${callIconAction}</div></div>
            <div><h4>Адрес доставки</h4><p>${Format.escape(order.address || order.district || "Адрес не указан")}</p>${order.clientLatitude && order.clientLongitude ? `<a class="link-more" href="${Format.escape(this.store.googleRouteUrl({ latitude: order.pharmacyLatitude, longitude: order.pharmacyLongitude }, { latitude: order.clientLatitude, longitude: order.clientLongitude }))}" target="_blank" rel="noopener">${Ui.icon("map-pin")} Показать маршрут</a>` : ""}</div>
            <div><h4>Тип получения</h4><p>${Ui.icon(order.type === "Самовывоз" ? "shopping-bag" : "bike")} ${Format.escape(order.type || "Доставка")}</p><h4>Плановое время</h4><p>${order.duration || 0} мин</p></div>
            <div><h4>Комментарий клиента</h4><p>Позвоните, пожалуйста, перед доставкой.</p></div>
            <div class="wide-actions"><h4>Быстрые действия</h4><div class="button-row">${callButtonAction}<button class="btn ghost" type="button" data-order-chat-focus="${Format.escape(order.id)}">${Ui.icon("message-circle")} Написать в чат</button><button class="btn ghost" type="button" data-order-print-receipt="${Format.escape(order.id)}">${Ui.icon("receipt-text")} Распечатать чек</button></div></div>
          </section>
          <section class="panel">
            <div class="panel-head"><h3>Состав заказа (${order.itemCount || 0} товаров)</h3><div class="button-row"><label class="check-row"><input type="checkbox" data-order-items-all="${Format.escape(order.id)}" ${allItemsCollected ? "checked" : ""} ${checklistLocked || !products.length ? "disabled" : ""} /> Выбрать все</label><button class="btn ghost" type="button" data-order-scan="${Format.escape(order.id)}" ${checklistLocked || !products.length ? "disabled" : ""}>${Ui.icon("scan")} Сканировать штрихкод</button></div></div>
            <div class="data-table" style="border:0; border-radius:0;">
              <div class="table-row table-head order-items"><span>Товар</span><span>Кол-во</span><span>Резерв / Остаток</span><span>Собрано</span></div>
              ${itemRows}
            </div>
            ${assemblyBlocked ? `<div class="assembly-warning">${Ui.icon("circle-alert")} <span>Отметьте все позиции как собранные, чтобы перевести заказ в статус «Собран».</span></div>` : ""}
            ${action ? `<div class="decision-grid"><button class="decision ok" data-order-action="${Format.escape(order.id)}" ${actionDisabled}>${Ui.icon("check-circle")}<strong>${action}</strong><span>Перевести заказ на следующий этап</span></button><button class="decision danger" data-order-cancel="${Format.escape(order.id)}">${Ui.icon("circle-x")}<strong>Отменить заказ</strong><span>Исключить заказ из активных</span></button></div>` : ""}
          </section>
        </main>
        <aside class="side-stack">
          <div class="panel side-card"><h3>Сумма заказа</h3><div class="summary-line"><span>Товары (${order.itemCount || 0})</span><strong>${Format.money(Number(order.amount) - Number(order.deliveryFee || 0))}</strong></div><div class="summary-line"><span>Доставка</span><strong>${Format.money(order.deliveryFee || 0)}</strong></div><hr /><div class="summary-line total"><span>Итого</span><strong>${Format.money(order.amount)}</strong></div><span class="status ${order.status === "Отменен" ? "danger" : "ok"}">${order.status === "Отменен" ? "Заказ отменен" : Format.escape(order.payment || "Оплата не указана")}</span></div>
          ${Ui.orderChat(order, "pharmacy")}
          ${Ui.orderHistory(order, "pharmacy")}
          ${order.type === "Доставка" ? `<div class="panel side-card courier-assignment"><h3>Курьер</h3><p class="muted">${order.courierName ? `Назначен: ${Format.escape(order.courierName)}` : "Назначьте курьера перед передачей заказа."}</p><select class="select-pill" data-courier-select>${courierOptions}</select><button class="btn ghost" type="button" data-courier-assign="${Format.escape(order.id)}">${Ui.icon("bike")} ${order.courierName ? "Изменить курьера" : "Назначить"}</button><p class="muted">Расчетное время: ${order.duration || 0} мин</p>${["Передан курьеру", "В пути", "Доставлен"].includes(order.status) ? `<a class="link-more" href="#courier">${Ui.icon("navigation")} Открыть экран курьера</a>` : ""}</div>` : ""}
        </aside>
      </div>
    `;
    return this.layout("partner-order", content);
  }

  pricing(state = {}) {
    const query = this.store.normalizeLookup(state.query);
    const pageSize = Math.max(10, Number(state.pageSize) || 20);
    const categories = Array.from(new Set(this.store.pharmacyInventory.map((product) => product.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
    const products = this.store.pharmacyInventory.filter((product) => {
      const pricing = this.store.productPricing(product);
      const matchesQuery = !query || this.store.normalizeLookup([product.name, product.mnn, product.barcode].join(" ")).includes(query);
      const matchesCategory = !state.category || product.category === state.category;
      const matchesPromotion = state.promotion === "active"
        ? Boolean(pricing.promotion)
        : state.promotion === "regular"
          ? !pricing.promotion
          : state.promotion === "above"
            ? pricing.aboveMarket
            : true;
      return matchesQuery && matchesCategory && matchesPromotion;
    });
    const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
    const currentPage = Math.min(Math.max(1, Number(state.page) || 1), totalPages);
    const pageStart = (currentPage - 1) * pageSize;
    const visibleProducts = products.slice(pageStart, pageStart + pageSize);
    const shownFrom = products.length ? pageStart + 1 : 0;
    const shownTo = Math.min(pageStart + pageSize, products.length);
    const paginationItems = [...new Set([
      1,
      currentPage - 1,
      currentPage,
      currentPage + 1,
      totalPages,
    ].filter((page) => page >= 1 && page <= totalPages))].sort((a, b) => a - b);
    const paginationMarkup = paginationItems.map((page, index) => {
      const previousPage = paginationItems[index - 1];
      const gap = previousPage && page - previousPage > 1 ? `<span class="pagination-gap" aria-hidden="true">...</span>` : "";
      return `${gap}<button type="button" data-pricing-page="${page}" class="${page === currentPage ? "active" : ""}" ${page === currentPage ? 'aria-current="page"' : ""}>${page}</button>`;
    }).join("");
    const stats = this.store.pricingStats();
    const promoted = this.store.pharmacyInventory.filter((product) => this.store.productPricing(product).promotion);
    const chartProduct = products[0] || this.store.pharmacyInventory[0] || null;
    const chartPricing = chartProduct ? this.store.productPricing(chartProduct) : null;
    const categoryOptions = `<option value="">Все категории</option>${categories.map((category) => `<option value="${Format.escape(category)}" ${state.category === category ? "selected" : ""}>${Format.escape(category)}</option>`).join("")}`;
    const content = `
      <section class="page-title">
        <div><h1>Цены и акции</h1><p>Управляйте ценами, акциями и конкурентоспособностью товаров в вашей аптеке.</p></div>
        <div class="button-row"><button class="btn primary" data-product-add>${Ui.icon("plus")} Добавить препарат</button><button class="btn ghost" data-excel-upload>${Ui.icon("file-spreadsheet")} Загрузить Excel</button></div>
      </section>
      <section class="metric-grid" style="grid-template-columns: repeat(4, minmax(0, 1fr));">
        ${this.metric("tag", "Товаров в акции", String(stats.activePromotions), `${this.store.pharmacyInventory.length} товаров в прайс-листе`)}
        ${this.metric("percent", "Средняя маржа", `${stats.averageMargin}%`, "По текущим закупочным ценам", "purple")}
        ${this.metric("upload", "Цена выше рынка", String(stats.aboveMarket), "По предложениям зарегистрированных аптек", "orange")}
        ${this.metric("clock", "Акции заканчиваются", String(stats.endingSoon), "В течение ближайших 3 дней", "red")}
      </section>
      <section class="pricing-tools">
        <form class="panel pricing-tool" data-bulk-price-form>
          <div><h3>Массовое изменение цен</h3><p class="muted">Измените базовую цену выбранной категории.</p></div>
          <select class="select-pill" name="category">${categoryOptions}</select>
          <label class="field"><span>Изменение, %</span><input name="percent" type="number" min="-90" max="200" step="0.1" placeholder="Например, 5 или -10" required /></label>
          <button class="btn primary" type="submit">${Ui.icon("refresh-cw")} Применить</button>
        </form>
        <form class="panel pricing-tool" data-promotion-form>
          <div><h3>Создать акцию</h3><p class="muted">Скидка сразу обновит цены в клиентском каталоге.</p></div>
          <label class="field"><span>Название</span><input name="title" placeholder="Весенняя скидка" /></label>
          <select class="select-pill" name="category">${categoryOptions}</select>
          <div class="form-two"><label class="field"><span>Скидка, %</span><input name="discount" type="number" min="1" max="89" required /></label><label class="field"><span>Действует до</span><input name="endAt" type="date" required /></label></div>
          <button class="btn primary" type="submit">${Ui.icon("tag")} Запустить акцию</button>
        </form>
      </section>
      <div class="filters-line"><div class="field has-icon">${Ui.icon("search")}<input type="search" data-pricing-query value="${Format.escape(state.query || "")}" placeholder="Поиск по названию товара, МНН или штрихкоду..." /></div><select class="select-pill" data-pricing-category>${categoryOptions}</select><select class="select-pill" data-pricing-promotion><option value="all">Все цены</option><option value="active" ${state.promotion === "active" ? "selected" : ""}>В акции</option><option value="regular" ${state.promotion === "regular" ? "selected" : ""}>Без акции</option><option value="above" ${state.promotion === "above" ? "selected" : ""}>Выше рынка</option></select><button class="btn ghost" type="button" data-pricing-reset>${Ui.icon("rotate-ccw")} Сбросить</button></div>
      <section class="panel">
        <div class="panel-head"><h3>Прайс-лист аптеки</h3><span class="status ok">Синхронизировано с остатками</span></div>
        ${this.pricingTable(visibleProducts, products.length)}
        ${products.length > pageSize ? `
          <div class="catalog-pagination-wrap order-pagination pricing-pagination">
            <p class="pagination-summary">Показано ${shownFrom}-${shownTo} из ${products.length}</p>
            <nav class="pagination" aria-label="Страницы прайс-листа">
              <button type="button" data-pricing-page="${currentPage - 1}" aria-label="Предыдущая страница" ${currentPage === 1 ? "disabled" : ""}>${Ui.icon("chevron-left")}</button>
              ${paginationMarkup}
              <button type="button" data-pricing-page="${currentPage + 1}" aria-label="Следующая страница" ${currentPage === totalPages ? "disabled" : ""}>${Ui.icon("chevron-right")}</button>
            </nav>
            <label class="page-size-control">Показывать по:<select class="select-pill" data-pricing-page-size><option value="20" ${pageSize === 20 ? "selected" : ""}>20</option><option value="50" ${pageSize === 50 ? "selected" : ""}>50</option><option value="100" ${pageSize === 100 ? "selected" : ""}>100</option></select></label>
          </div>
        ` : ""}
      </section>
      <section class="dashboard-grid">
        <div class="panel"><div class="panel-head"><h3>Активные акции</h3><span class="status ok">${promoted.length}</span></div>${promoted.length ? `<div class="small-list">${promoted.slice(0, 8).map((product) => `<div class="small-row" style="grid-template-columns:1fr auto;"><div><strong>${Format.escape(product.promotion.title)}</strong><p class="trend">${Format.escape(product.name)} · скидка ${product.promotion.discount}%</p><p class="muted">До ${new Date(product.promotion.endAt).toLocaleDateString("ru-RU")}</p></div><strong>${Format.money(product.price)}</strong></div>`).join("")}</div>` : `<div class="panel-empty"><p>Активных акций пока нет.</p></div>`}</div>
        <div class="panel promo-card"><h3>Синхронизация каталога</h3><p class="muted">После сохранения цены клиентский каталог и сравнение аптек обновляются автоматически.</p><div class="coupon-box"><span>Опубликовано товаров</span><strong>${this.store.pharmacyInventory.filter((product) => product.published !== false).length}</strong><small>Последнее обновление: сейчас</small></div><a class="btn ghost" href="#home">${Ui.icon("eye")} Открыть каталог клиента</a></div>
        <div class="panel"><div class="panel-head"><h3>${chartProduct ? `Цена: ${Format.escape(chartProduct.name)}` : "Динамика цен"}</h3></div>${chartProduct ? `<div class="pricing-current"><div><small>Текущая цена</small><strong>${Format.money(chartPricing.salePrice)}</strong></div><div><small>Средняя по рынку</small><strong>${Format.money(chartPricing.marketPrice)}</strong></div><div><small>Маржа</small><strong>${chartPricing.margin}%</strong></div></div><div class="price-history-list">${(chartProduct.priceHistory || []).slice(-5).reverse().map((entry) => `<div><span>${new Date(entry.changedAt).toLocaleDateString("ru-RU")}</span><strong>${Format.money(entry.price)}</strong></div>`).join("") || `<p class="muted">История появится после изменения цены.</p>`}</div>` : `<div class="panel-empty"><p>Добавьте препарат, чтобы управлять ценой.</p></div>`}</div>
      </section>
    `;
    return this.layout("pricing", content);
  }

  analytics(period = "7") {
    const snapshot = this.store.analyticsSnapshot(period);
    const { orders, stats, completed, revenue, cost, profit, deliveryRevenue, units, categoryMap, paymentMap, productMap, dailyMap } = snapshot;
    const commission = Math.round(revenue * 0.075);
    const payout = revenue - commission;
    const averageCheck = completed.length ? Math.round(revenue / completed.length) : 0;
    const percentage = (value, total) => total ? Math.round((value / total) * 1000) / 10 : 0;
    const periodLabels = { "1": "Сегодня", "7": "7 дней", "30": "30 дней", "0": "Всё время" };

    const categories = Array.from(categoryMap, ([name, sum]) => ({ name, sum, pct: percentage(sum, revenue) })).sort((a, b) => b.sum - a.sum);
    const payments = Array.from(paymentMap, ([name, sum]) => ({ name, sum, pct: percentage(sum, revenue) })).sort((a, b) => b.sum - a.sum);
    const products = Array.from(productMap, ([name, data]) => ({ name, ...data })).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    const days = Array.from(dailyMap, ([date, sum]) => ({ date, sum })).sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
    const maxDay = Math.max(1, ...days.map((day) => day.sum));
    const completionRate = percentage(stats.completed, stats.total);
    const cancellationRate = percentage(stats.cancelled, stats.total);
    const activeRate = percentage(stats.total - stats.completed - stats.cancelled, stats.total);
    const paymentColors = ["var(--green)", "#23c6b7", "#8367db", "#ffc857"];
    let paymentCursor = 0;
    const paymentSegments = payments.slice(0, 4).map((item, index) => {
      const start = paymentCursor;
      paymentCursor += item.pct;
      return `${paymentColors[index]} ${start}% ${paymentCursor}%`;
    });
    const donutBackground = paymentSegments.length
      ? `radial-gradient(circle, #fff 0 49%, transparent 50%), conic-gradient(${paymentSegments.join(", ")})`
      : "radial-gradient(circle, #fff 0 49%, transparent 50%), conic-gradient(#e7edf5 0 100%)";
    const content = `
      <section class="page-title">
        <div><h1>Аналитика и финансы</h1><p>Отслеживайте ключевые показатели, продажи и выплаты вашей аптеки.</p></div>
        <button class="btn ghost" data-analytics-export>${Ui.icon("download")} Экспортировать CSV</button>
      </section>
      <div class="segmented analytics-periods">${Object.entries(periodLabels).map(([value, label]) => `<button class="${String(period) === value ? "active" : ""}" data-analytics-period="${value}">${label}</button>`).join("")}</div>
      <section class="metric-grid">
        ${this.metric("coins", "Выручка товаров", Format.money(revenue), `${stats.completed} доставленных заказов`)}
        ${this.metric("receipt-text", "Все заказы", String(stats.total), `Период: ${periodLabels[String(period)] || periodLabels["7"]}`)}
        ${this.metric("triangle-alert", "Средний чек", Format.money(averageCheck), `${units} проданных единиц`, "orange")}
        ${this.metric("percent", "Комиссия платформы", Format.money(commission), "7,5% от выручки", "orange")}
        ${this.metric("banknote", "К выплате", Format.money(payout), "Выручка минус комиссия")}
      </section>
      <section class="analytics-grid">
        <div class="panel wide"><div class="panel-head"><h3>Выручка по дням</h3><span class="status ok">${Format.money(revenue)}</span></div>${days.length ? `<div class="bar-chart analytics-days">${days.map((day) => `<div><strong>${Format.money(day.sum)}</strong><span style="height:${Math.max(10, Math.round((day.sum / maxDay) * 180))}px"></span><em>${day.date.slice(5).split("-").reverse().join(".")}</em></div>`).join("")}</div>` : `<div class="panel-empty"><p>За выбранный период доставленных заказов нет.</p></div>`}</div>
        <div class="panel"><div class="panel-head"><h3>Выручка по категориям</h3></div>${categories.length ? `<div class="category-bars">${categories.map((item) => `<div><span>${Format.escape(item.name)}</span><strong>${Format.money(item.sum)}</strong><div><i style="width:${item.pct}%"></i></div><small>${item.pct}%</small></div>`).join("")}</div>` : `<div class="panel-empty"><p>Нет данных по категориям.</p></div>`}</div>
        <div class="panel"><div class="panel-head"><h3>Способы оплаты</h3></div><div class="donut-card"><div class="donut" style="background:${donutBackground}"><strong>${new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(revenue)}</strong><span>Выручка</span></div><div class="legend">${payments.length ? payments.map((item, index) => `<div><span class="dot c${index}"></span>${Format.escape(item.name)}<strong>${Format.money(item.sum)}</strong><em>${item.pct}%</em></div>`).join("") : `<p class="muted">Нет завершенных оплат.</p>`}</div></div></div>
        <div class="panel"><div class="panel-head"><h3>Ключевые показатели</h3></div><div class="kpi-list"><div><span>Валовая прибыль</span><strong>${Format.money(profit)}</strong><em>${revenue ? `${percentage(profit, revenue)}% от выручки` : "Нет продаж"}</em></div><div><span>Себестоимость</span><strong>${Format.money(cost)}</strong><em>${units} единиц</em></div><div><span>Доставка отдельно</span><strong>${Format.money(deliveryRevenue)}</strong><em>Не включена в товарную выручку</em></div><div><span>Доля доставленных</span><strong>${completionRate}%</strong><em class="trend">${stats.completed} заказов</em></div><div><span>Доля отмен</span><strong>${cancellationRate}%</strong><em class="${stats.cancelled ? "danger-text" : "trend"}">${stats.cancelled} заказов</em></div><div><span>Среднее время выполнения</span><strong>${stats.averageAssembly} мин</strong><em>${stats.completed ? "Расчет по факту" : "Нет данных"}</em></div></div></div>
        <div class="panel"><div class="panel-head"><h3>Топ товаров</h3></div>${products.length ? this.simpleRows(products.map((product) => `${product.name}|${Format.money(product.revenue)}|${product.sold}`), ["Товар", "Выручка", "Позиций"]) : `<div class="panel-empty"><p>Топ появится после доставленных заказов.</p></div>`}</div>
        <div class="panel"><div class="panel-head"><h3>Структура заказов</h3></div><div class="kpi-list"><div><span>Новые</span><strong>${stats.new}</strong><em>${Format.money(stats.newAmount)}</em></div><div><span>Подтверждены</span><strong>${stats.confirmed}</strong><em>${Format.money(stats.confirmedAmount)}</em></div><div><span>В сборке</span><strong>${stats.assembly}</strong><em>${Format.money(stats.assemblyAmount)}</em></div><div><span>У курьера</span><strong>${stats.courier}</strong><em>${Format.money(stats.courierAmount)}</em></div></div></div>
      </section>
    `;
    return this.layout("analytics", content);
  }

  support() {
    const orders = this.store.orders.slice().sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
    const reviewResponses = this.store.reviewResponses();
    const savedChatMessages = this.store.supportMessages();
    const initials = (name) => String(name || "Клиент")
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "К";
    const reviewText = (order, rating) => {
      if (order.status === "Отменен") return "Заказ отменили, хочу получить понятный ответ по возврату средств.";
      if (Number(order.duration) > 70) return "Заказ доставили, но ожидание было дольше обычного. Нужна более точная коммуникация по времени.";
      if (rating >= 5) return "Заказ собрали аккуратно, цена и наличие совпали. Спасибо за быстрый сервис.";
      return "В целом всё хорошо, но хотелось бы быстрее получать обновления по статусу заказа.";
    };
    const orderReview = (order) => {
      const review = order.review && typeof order.review === "object" ? order.review : null;
      const rating = Math.round(Number(review?.rating) || 0);
      if (!review || rating < 1 || rating > 5) return null;
      return {
        rating: Math.max(1, Math.min(5, rating)),
        text: String(review.text || "").trim(),
        date: review.updatedAt || review.createdAt || order.reviewedAt || order.updatedAt || order.createdAt,
      };
    };
    const reviews = orders
      .filter((order) => orderReview(order) || ["Доставлен", "Отменен"].includes(order.status))
      .slice(0, 8)
      .map((order) => {
        const savedReview = orderReview(order);
        const rating = savedReview?.rating || (order.status === "Отменен" ? 2 : Number(order.duration) > 70 ? 4 : 5);
        return {
          order,
          initials: initials(order.client),
          name: order.client || "Клиент DoriGo",
          rating,
          text: savedReview?.text || reviewText(order, rating),
          date: Format.dateTime(savedReview?.date || order.updatedAt || order.createdAt || new Date()),
          response: reviewResponses[order.id] || null,
        };
      });
    const tickets = orders
      .filter((order) => order.status === "Отменен" || Number(order.duration) > 70 || ["Новый", "Подтвержден"].includes(order.status))
      .slice(0, 10)
      .map((order, index) => {
        const cancelled = order.status === "Отменен";
        const slow = Number(order.duration) > 70;
        return {
          id: `#SUP-${String(index + 1).padStart(3, "0")}`,
          order,
          topic: cancelled ? "Возврат средств" : slow ? "Контроль доставки" : "Нужно подтвердить заказ",
          priority: cancelled ? "Высокий" : slow ? "Средний" : "Низкий",
          status: cancelled ? "Нужен ответ" : slow ? "В работе" : "Новый",
          owner: cancelled ? "Оператор" : slow ? (order.courierName || "Логистика") : "Фармацевт",
        };
      });
    const averageRating = reviews.length
      ? (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(1)
      : "—";
    const unansweredReviews = reviews.filter((review) => !review.response).length;
    const needsAnswer = tickets.filter((ticket) => !["Решено", "Закрыто"].includes(ticket.status)).length + unansweredReviews;
    const resolved = this.store.orders.filter((order) => order.status === "Доставлен").length;
    const selectedReview = reviews.find((review) => review.order.id === this.store.selectedSupportReviewId)
      || reviews.find((review) => review.rating < 5 && !review.response)
      || reviews.find((review) => !review.response)
      || reviews[0]
      || null;
    const ticketRows = tickets.map((ticket) => `${ticket.id}|${ticket.topic}|${ticket.priority}|${ticket.status}|${ticket.owner}`);
    const seededChatMessages = [
      { author: "support", text: `Здравствуйте! Мы видим ${tickets.length} открытых обращений по вашей аптеке.`, createdAt: new Date().toISOString() },
      ...(tickets[0]
        ? [
          { author: "pharmacy", text: `Проверьте, пожалуйста, ${tickets[0].topic.toLowerCase()} по заказу #${tickets[0].order.id}.`, createdAt: new Date().toISOString() },
          { author: "support", text: `Приняли. Ответственный: ${tickets[0].owner}. Статус: ${tickets[0].status}.`, createdAt: new Date().toISOString() },
        ]
        : [{ author: "support", text: "Критичных обращений нет. Если появится вопрос, напишите нам здесь.", createdAt: new Date().toISOString() }]),
    ];
    const chatMessages = (savedChatMessages.length ? savedChatMessages : seededChatMessages).slice(-8);
    const chatHtml = chatMessages.map((message) => {
      const attachment = message.attachment;
      const attachmentHtml = attachment
        ? `<div class="chat-attachment">${Ui.icon("paperclip")}<span><strong>${Format.escape(attachment.name)}</strong><small>${Format.escape(attachment.type || "Файл")} · ${Format.fileSize(attachment.size)}</small></span></div>`
        : "";
      return `<div class="chat-message ${message.author === "pharmacy" ? "mine" : "support"}"><p>${Format.escape(message.text)}</p>${attachmentHtml}<small>${Format.escape(Format.dateTime(message.createdAt))}</small></div>`;
    }).join("");
    const faqItems = [
      ["Как ответить на отзыв клиента?", "Выберите отзыв в списке, напишите короткий ответ от имени аптеки и нажмите «Опубликовать ответ». Ответ сохранится в истории заказа."],
      ["Как оформить возврат средств?", "Откройте заказ со статусом «Отменен», проверьте способ оплаты и передайте обращение оператору DoriGo через чат поддержки."],
      ["Что делать, если клиент недоволен доставкой?", "Проверьте время сборки, назначенного курьера и комментарий клиента. Если задержка была на стороне аптеки, отправьте клиенту ответ с извинением и решением."],
      ["Как изменить статус обращения?", "Статус меняется автоматически по заказам: новые, задержанные и отмененные заказы попадают в обращения, доставленные уходят в решенные."],
      ["Правила общения с клиентами", "Пишите конкретно и спокойно: подтвердите проблему, назовите действие аптеки и укажите, когда клиент получит решение."],
    ];
    const content = `
      <section class="page-title">
        <div><h1>Отзывы и поддержка</h1><p>Следите за репутацией аптеки, отвечайте клиентам и контролируйте обращения по реальным заказам.</p></div>
        <div class="button-row"><button class="btn ghost" data-support-export>${Ui.icon("download")} Экспорт отчёта</button><button class="date-pill">${Ui.icon("calendar")} Обновлено ${Format.dateTime(new Date())}</button></div>
      </section>
      <section class="metric-grid" style="grid-template-columns: repeat(4, minmax(0, 1fr));">
        ${this.metric("star", "Рейтинг аптеки", String(averageRating), reviews.length ? `${reviews.length} отзывов по заказам` : "Появится после доставок")}
        ${this.metric("badge-alert", "Открытые обращения", String(tickets.length), tickets.length ? "По заказам аптеки" : "Нет открытых обращений", tickets.length ? "red" : "green")}
        ${this.metric("message-circle", "Нужен ответ", String(needsAnswer), "Отзывы и обращения", needsAnswer ? "purple" : "green")}
        ${this.metric("check-circle", "Решено", String(resolved), "Доставленные заказы")}
      </section>
      <section class="support-grid">
        <main class="side-stack">
          <div class="panel"><div class="panel-head"><h3>Отзывы клиентов</h3><span class="status ok">${reviews.length}</span></div><div class="review-list">${reviews.length ? reviews.map((review, index) => `<article class="review-item ${review.response ? "answered" : ""}"><span class="avatar ${index % 2 ? "purple" : ""}">${Format.escape(review.initials)}</span><div><div class="review-top"><strong>${Format.escape(review.name)}</strong><small>Заказ #${Format.escape(review.order.id)}</small><time>${Format.escape(review.date)}</time></div><div class="stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</div><p>${Format.escape(review.text)}</p>${review.response ? `<div class="review-response-note"><strong>Ответ аптеки</strong><p>${Format.escape(review.response.response)}</p><small>${Format.escape(Format.dateTime(review.response.updatedAt))}</small></div>` : ""}</div><button class="btn small ghost" data-review-focus="${Format.escape(review.order.id)}">${review.response ? "Изменить" : "Ответить"}</button></article>`).join("") : `<div class="panel-empty"><span>${Ui.icon("star")}</span><p>Отзывы появятся здесь после доставленных или отмененных заказов.</p></div>`}</div></div>
          <div class="panel"><div class="panel-head"><h3>Обращения и жалобы</h3><span class="status ${tickets.length ? "warn" : "ok"}">${tickets.length}</span></div>${ticketRows.length ? this.simpleRows(ticketRows, ["N обращения", "Тема", "Приоритет", "Статус", "Ответственный"]) : `<div class="panel-empty"><span>${Ui.icon("check-circle")}</span><p>Открытых обращений пока нет. Новые появятся из отмененных, задержанных и неподтвержденных заказов.</p></div>`}</div>
        </main>
        <aside class="side-stack">
          <form class="panel side-card" data-review-response-form>
            <div class="panel-head slim"><h3>Ответ клиенту</h3><span class="status ${selectedReview ? "warn" : "ok"}">${selectedReview ? "Нужен ответ" : "Готово"}</span></div>
            ${selectedReview ? `<strong>${Format.escape(selectedReview.name)}</strong><small class="muted">Заказ #${Format.escape(selectedReview.order.id)} · ${Format.escape(selectedReview.date)}</small><div class="stars">${"★".repeat(selectedReview.rating)}${"☆".repeat(5 - selectedReview.rating)}</div><p>${Format.escape(selectedReview.text)}</p><input type="hidden" name="orderId" value="${Format.escape(selectedReview.order.id)}" /><label class="field"><span>Ваш ответ</span><textarea name="response" required placeholder="Напишите ответ клиенту...">${Format.escape(selectedReview.response?.response || `Здравствуйте! Спасибо за обратную связь. Мы проверим заказ #${selectedReview.order.id} и вернёмся с решением.`)}</textarea></label><button class="btn primary" type="submit">${selectedReview.response ? "Сохранить ответ" : "Опубликовать ответ"}</button>` : `<div class="panel-empty"><span>${Ui.icon("message-circle")}</span><p>Сейчас нет отзывов, требующих ответа.</p></div>`}
          </form>
          <form class="panel side-card" data-support-chat-form>
            <h3>Чат с поддержкой DoriGo</h3><span class="status ok">Онлайн</span>
            <div class="chat-box">${chatHtml}</div>
            <div class="chat-input"><input name="message" placeholder="Введите сообщение..." /><input class="visually-hidden-file" data-support-attachment type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv" /><button class="icon-button" type="button" data-support-attachment-button title="Прикрепить файл">${Ui.icon("paperclip")}</button><button class="btn primary" type="submit">${Ui.icon("send")}</button></div>
          </form>
          <div class="panel side-card"><div class="panel-head slim"><h3>Частые вопросы</h3><span class="status ok">${faqItems.length}</span></div><div class="faq-list">${faqItems.map(([question, answer], index) => `<details class="faq-item" ${index === 0 ? "open" : ""}><summary>${Format.escape(question)}${Ui.icon("chevron-right")}</summary><p>${Format.escape(answer)}</p></details>`).join("")}</div></div>
        </aside>
      </section>
    `;
    return this.layout("support", content);
  }

  settings(activeTab = "profile") {
    const pharmacy = this.store.accounts.activePharmacy();
    const account = this.store.accounts.pharmacyAccount();
    if (!pharmacy) {
      return this.layout("settings", `<div class="inventory-empty"><h2>Добавьте аптеку</h2><p>Для настройки кабинета нужна хотя бы одна торговая точка.</p></div>`);
    }
    const tabs = [
      ["profile", "Профиль аптеки"],
      ["hours", "График работы"],
      ["delivery", "Доставка и самовывоз"],
      ["payments", "Оплата"],
      ["employees", "Сотрудники и роли"],
      ["documents", "Документы и лицензия"],
      ["notifications", "Уведомления"],
    ];
    const content = `
      <form data-settings-form data-settings-tab="${activeTab}">
        <section class="page-title">
          <div><h1>Настройки аптеки</h1><p>Редактируйте данные выбранной точки. Все изменения сохраняются в системе.</p></div>
          <div class="button-row">
            <button class="btn ghost" type="reset">Отмена</button>
            <button class="btn primary" type="submit">${Ui.icon("check")} Сохранить изменения</button>
          </div>
        </section>
        <div class="partner-tabs settings-tabs">
          ${tabs.map(([id, label]) => `<button type="button" class="${activeTab === id ? "active" : ""}" data-settings-tab="${id}">${label}</button>`).join("")}
        </div>
        ${this.settingsSection(activeTab, pharmacy, account)}
      </form>
    `;
    return this.layout("settings", content);
  }

  settingsSection(tab, pharmacy, account) {
    if (tab === "hours") return this.scheduleSettings(pharmacy);
    if (tab === "delivery") return this.deliverySettings(pharmacy);
    if (tab === "payments") return this.paymentSettings(pharmacy);
    if (tab === "employees") return this.employeeSettings(pharmacy);
    if (tab === "documents") return this.documentSettings(pharmacy);
    if (tab === "notifications") return this.notificationSettings(pharmacy);
    return this.profileSettings(pharmacy, account);
  }

  profileSettings(pharmacy, account) {
    const logo = pharmacy.logoData
      ? `<img src="${Format.escape(pharmacy.logoData)}" alt="${Format.escape(pharmacy.name)}" />`
      : Ui.icon("cross");
    return `
      <section class="settings-grid">
        <div class="panel settings-card">
          <h3>Основная информация</h3>
          <div class="logo-upload">
            <div class="mini-logo">${logo}</div>
            <label class="btn ghost upload-label">${Ui.icon("upload")} Загрузить логотип<input type="file" name="logo" accept="image/png,image/jpeg,image/webp" /></label>
            <p class="muted">JPG, PNG или WEBP, не более 2 МБ</p>
          </div>
          ${this.settingsInput("Название аптеки", "name", pharmacy.name, "text", true)}
          ${this.settingsInput("Код филиала", "branchCode", pharmacy.branchCode)}
          ${this.settingsInput("Адрес", "address", pharmacy.address, "text", true)}
          <div class="form-two">
            ${this.settingsInput("Город", "city", pharmacy.city)}
            ${this.settingsInput("Район", "district", pharmacy.district)}
          </div>
          <div class="form-two">
            ${this.settingsInput("Телефон", "phone", pharmacy.phone, "tel")}
            ${this.settingsInput("Email", "email", pharmacy.email, "email")}
          </div>
          ${this.settingsInput("Ответственный менеджер", "manager", pharmacy.manager)}
        </div>
        <div class="panel settings-card">
          <h3>Расположение аптеки</h3>
          <div class="settings-map dynamic-map pharmacy-location-preview">
            ${Ui.mapSurface({
              latitude: pharmacy.latitude,
              longitude: pharmacy.longitude,
              zoom: 15,
              className: "settings-preview-map",
              label: `Расположение ${pharmacy.name}`,
              markers: [{
                latitude: pharmacy.latitude,
                longitude: pharmacy.longitude,
                type: "pharmacy",
                icon: "hospital",
                label: pharmacy.name,
                active: true,
              }],
            })}
            <div class="pharmacy-location-overlay">
              <span>${Ui.icon("hospital")}</span>
              <strong>${Format.escape(pharmacy.name)}</strong>
              <small>${Format.escape(pharmacy.address || "Адрес не указан")}</small>
            </div>
          </div>
          <div class="form-two">
            ${this.settingsInput("Широта", "latitude", pharmacy.latitude, "number")}
            ${this.settingsInput("Долгота", "longitude", pharmacy.longitude, "number")}
          </div>
          <button class="btn ghost pharmacy-map-button" type="button" data-pharmacy-location>${Ui.icon("map-pin")} Выбрать точку на карте</button>
          <p class="muted">Координаты используются для расчета расстояния, зоны доставки и маршрута курьера.</p>
        </div>
        <div class="panel settings-card">
          <h3>Описание аптеки</h3>
          <label class="settings-input"><span>Описание для клиентов</span><textarea name="description" maxlength="500" data-description>${Format.escape(pharmacy.description)}</textarea></label>
          <p class="muted"><span data-description-count>${pharmacy.description.length}</span> / 500</p>
        </div>
        <div class="panel settings-card">
          <h3>Банковские реквизиты</h3>
          <div class="form-two">
            ${this.settingsInput("Номер счета (IBAN)", "iban", pharmacy.bank.iban)}
            ${this.settingsInput("Название банка", "bankName", pharmacy.bank.name)}
          </div>
          <div class="form-two">
            ${this.settingsInput("ИНН", "tin", pharmacy.bank.tin)}
            ${this.settingsInput("МФО", "mfo", pharmacy.bank.mfo)}
          </div>
          ${this.settingsInput("Получатель", "recipient", pharmacy.bank.recipient)}
        </div>
        <div class="panel settings-card settings-wide">
          <div class="panel-head">
            <div><h3>Аптеки сети</h3><p class="muted">${Format.escape(account.organization || "Партнер DoriGo")} · ${account.pharmacies.length} точек</p></div>
          </div>
          <div class="network-list">
            ${account.pharmacies.map((item) => `
              <button type="button" class="network-branch ${item.id === pharmacy.id ? "active" : ""}" data-pharmacy-switch="${Format.escape(item.id)}">
                <span class="mini-logo">${Ui.icon("hospital")}</span>
                <span><strong>${Format.escape(item.name)}</strong><small>${Format.escape(item.address || "Адрес не указан")}</small></span>
                <span class="status ${item.id === pharmacy.id ? "ok" : "blue"}">${item.id === pharmacy.id ? "Выбрана" : "Открыть"}</span>
              </button>
            `).join("")}
          </div>
          <div class="network-add">
            <h4>Добавить еще одну аптеку</h4>
            <div class="network-add-fields">
              <input name="newPharmacyName" placeholder="Название филиала" />
              <input name="newPharmacyAddress" placeholder="Адрес" />
              <input name="newPharmacyPhone" placeholder="Телефон" />
              <button class="btn ghost" type="button" data-pharmacy-add>${Ui.icon("plus")} Добавить аптеку</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  scheduleSettings(pharmacy) {
    const days = [["mon", "Понедельник"], ["tue", "Вторник"], ["wed", "Среда"], ["thu", "Четверг"], ["fri", "Пятница"], ["sat", "Суббота"], ["sun", "Воскресенье"]];
    return `
      <section class="panel settings-card settings-single">
        <div class="panel-head"><div><h3>График работы</h3><p class="muted">Время отображается клиентам и влияет на доступность заказов.</p></div></div>
        <div class="schedule-list">
          ${days.map(([id, label]) => {
            const hours = pharmacy.hours[id];
            return `<div class="schedule-row">
              <label class="toggle-control"><input type="checkbox" name="${id}Enabled" ${hours.enabled ? "checked" : ""} /><span class="toggle"></span><strong>${label}</strong></label>
              <label>Открытие<input type="time" name="${id}Open" value="${hours.open}" /></label>
              <label>Закрытие<input type="time" name="${id}Close" value="${hours.close}" /></label>
            </div>`;
          }).join("")}
        </div>
      </section>
    `;
  }

  deliverySettings(pharmacy) {
    return `
      <section class="settings-grid">
        <div class="panel settings-card">
          <h3>Способы получения</h3>
          <div class="toggle-grid">
            ${this.settingsToggle("Доставка курьером", "deliveryEnabled", pharmacy.delivery.enabled, "truck")}
            ${this.settingsToggle("Самовывоз из аптеки", "pickup", pharmacy.delivery.pickup, "shopping-bag")}
          </div>
        </div>
        <div class="panel settings-card">
          <h3>Условия доставки</h3>
          <div class="form-two">
            ${this.settingsInput("Минимальная сумма, сум", "minOrder", pharmacy.delivery.minOrder, "number")}
            ${this.settingsInput("Время сборки, минут", "assemblyMinutes", pharmacy.delivery.assemblyMinutes, "number")}
            ${this.settingsInput("Радиус доставки, км", "radius", pharmacy.delivery.radius, "number")}
            ${this.settingsInput("Стоимость доставки, сум", "fee", pharmacy.delivery.fee, "number")}
          </div>
        </div>
      </section>
    `;
  }

  paymentSettings(pharmacy) {
    return `
      <section class="panel settings-card settings-single">
        <h3>Способы оплаты</h3>
        <p class="muted">Оставьте включенными только те способы, которые принимает выбранная аптека.</p>
        <div class="payment-grid">
          ${this.settingsToggle("Наличные", "cash", pharmacy.payments.cash, "banknote")}
          ${this.settingsToggle("Click", "click", pharmacy.payments.click, "credit-card")}
          ${this.settingsToggle("Банковская карта", "card", pharmacy.payments.card, "credit-card")}
          ${this.settingsToggle("Payme", "payme", pharmacy.payments.payme, "banknote")}
        </div>
      </section>
    `;
  }

  employeeSettings(pharmacy) {
    return `
      <section class="panel settings-card settings-single">
        <div class="panel-head"><div><h3>Сотрудники и роли</h3><p class="muted">Добавляйте сотрудников и задавайте уровень доступа.</p></div></div>
        <div class="employee-add">
          <input name="employeeName" placeholder="Имя сотрудника" />
          <select name="employeeRole"><option>Фармацевт</option><option>Управляющий</option><option>Оператор</option><option>Кассир</option></select>
          <input name="employeePhone" placeholder="+998 90 123-45-67" />
          <select name="employeeAccess"><option>Заказы и товары</option><option>Только заказы</option><option>Полный доступ</option><option>Касса</option></select>
          <button class="btn primary" type="button" data-employee-add>${Ui.icon("plus")} Добавить</button>
        </div>
        <div class="employee-list">
          ${pharmacy.employees.length ? pharmacy.employees.map((employee) => `
            <div class="employee-row">
              <span class="avatar">${Format.escape(employee.name.charAt(0))}</span>
              <span><strong>${Format.escape(employee.name)}</strong><small>${Format.escape(employee.phone)}</small></span>
              <span>${Format.escape(employee.role)}</span>
              <span>${Format.escape(employee.access)}</span>
              <button class="icon-button danger" type="button" data-employee-delete="${Format.escape(employee.id)}">${Ui.icon("trash-2")}</button>
            </div>
          `).join("") : `<div class="panel-empty">${Ui.icon("user-plus")}<strong>Сотрудников пока нет</strong><span>Добавьте первого сотрудника выше.</span></div>`}
        </div>
      </section>
    `;
  }

  documentSettings(pharmacy) {
    return `
      <section class="panel settings-card settings-single">
        <div class="panel-head"><div><h3>Документы и лицензия</h3><p class="muted">Файлы сохраняются в карточке аптеки. На этом этапе хранится информация о файле.</p></div>
          <label class="btn primary upload-label">${Ui.icon("upload")} Загрузить документ<input type="file" data-document-input accept=".pdf,.png,.jpg,.jpeg" /></label>
        </div>
        <div class="document-list">
          ${pharmacy.documents.length ? pharmacy.documents.map((document) => `
            <div class="document-row">
              <span class="icon-tile red">${Ui.icon("file-text")}</span>
              <div><strong>${Format.escape(document.name)}</strong><p class="muted">${Math.max(1, Math.round(document.size / 1024))} КБ · ${new Date(document.uploadedAt).toLocaleDateString("ru-RU")}</p></div>
              <span class="status ok">${Format.escape(document.status)}</span>
              <button class="icon-button danger" type="button" data-document-delete="${Format.escape(document.id)}">${Ui.icon("trash-2")}</button>
            </div>
          `).join("") : `<div class="panel-empty">${Ui.icon("file-text")}<strong>Документы не загружены</strong><span>Добавьте лицензию или сертификат.</span></div>`}
        </div>
      </section>
    `;
  }

  notificationSettings(pharmacy) {
    const rows = [
      ["orders", "Новые заказы", "Уведомлять о каждом новом заказе"],
      ["lowStock", "Низкий остаток товаров", "Предупреждать о товарах, которые заканчиваются"],
      ["system", "Системные уведомления", "Важные изменения и обновления DoriGo"],
      ["reviews", "Отзывы клиентов", "Новые отзывы и оценки аптеки"],
      ["marketing", "Акции и маркетинг", "Новости и специальные предложения"],
    ];
    return `
      <section class="panel settings-card settings-single">
        <h3>Уведомления</h3>
        <div class="notification-settings">
          ${rows.map(([id, title, description]) => `<label><span><strong>${title}</strong><small>${description}</small></span><input class="toggle-input" type="checkbox" name="${id}" ${pharmacy.notifications[id] ? "checked" : ""} /><span class="toggle"></span></label>`).join("")}
        </div>
      </section>
      <section class="panel settings-card settings-single backup-card">
        <div>
          <span class="icon-tile">${Ui.icon("database")}</span>
          <div>
            <h3>Резервная копия данных</h3>
            <p class="muted">Сохраните локальную базу DoriGo: аккаунты, филиалы, заказы, остатки, цены, настройки, каталог и курьерские данные.</p>
          </div>
        </div>
        <div class="backup-actions">
          <button class="btn ghost" type="button" data-backup-export>${Ui.icon("download")} Скачать копию</button>
          <button class="btn primary" type="button" data-backup-import>${Ui.icon("upload")} Восстановить из файла</button>
        </div>
        <small>Восстановление заменяет локальные данные браузера данными из выбранного JSON-файла.</small>
      </section>
    `;
  }

  settingsInput(label, name, value, type = "text", required = false) {
    const step = type === "number" ? ' step="any"' : "";
    return `<label class="settings-input"><span>${label}${required ? " *" : ""}</span><input name="${name}" type="${type}" value="${Format.escape(value)}" ${required ? "required" : ""}${step} /></label>`;
  }

  settingsToggle(label, name, checked, icon) {
    return `<label>${Ui.icon(icon)} <span>${label}</span><input class="toggle-input" type="checkbox" name="${name}" ${checked ? "checked" : ""} /><span class="toggle"></span></label>`;
  }

  categories() {
    const categories = this.store.categoryStats();
    const totalProducts = this.store.pharmacyInventory.length;
    const onlineCount = categories.filter((category) => category.online).length;
    const hiddenCount = categories.length - onlineCount;
    const limitedCount = categories.filter((category) => category.prescription !== "Без ограничений").length;
    const lowStockCategories = categories.filter((category) => category.lowStock > 0).length;
    const content = `
      <section class="page-title">
        <div><h1>Категории</h1><p>Контролируйте ассортимент по категориям и ограничения онлайн-продажи.</p></div>
      </section>
      <section class="metric-grid" style="grid-template-columns: repeat(4, minmax(0, 1fr));">
        ${this.metric("shapes", "Категорий", String(categories.length), `${onlineCount} открыты на витрине`)}
        ${this.metric("package-check", "Товаров в категориях", String(totalProducts), "По текущей аптеке", "blue")}
        ${this.metric("shield-alert", "С ограничениями", String(limitedCount), "Рецептурность и контроль", "orange")}
        ${this.metric("triangle-alert", "Низкие остатки", String(lowStockCategories), "Категории требуют внимания", lowStockCategories ? "red" : "green")}
      </section>
      <form class="panel category-form" data-category-form>
        <label class="field"><span>Название категории</span><input name="name" required placeholder="Например, Дерматология" /></label>
        <label class="field"><span>Тип отпуска</span><select name="prescription"><option>Без ограничений</option><option>Без рецепта</option><option>По рецепту</option><option>Контролируемый</option></select></label>
        <label class="category-online"><input name="online" type="checkbox" checked /> <span>Разрешить онлайн-продажу</span></label>
        <button class="btn primary" type="submit">${Ui.icon("plus")} Добавить категорию</button>
      </form>
      <section class="panel">
        <div class="panel-head"><h3>Категории аптеки (${categories.length})</h3><span class="status ${hiddenCount ? "warn" : "ok"}">${hiddenCount ? `${hiddenCount} скрыто` : "Все доступны"}</span></div>
        ${categories.length ? `<div class="data-table categories-table" style="border:0; border-radius:0;"><div class="table-row table-head categories-manage"><span>Категория</span><span>Ассортимент</span><span>Тип отпуска</span><span>Онлайн-продажа</span><span>Действия</span></div>${categories.map((category) => `<div class="table-row categories-manage"><div><strong>${Format.escape(category.name)}</strong><div class="category-progress" title="${category.share}% ассортимента"><i style="width:${category.share}%"></i></div></div><button class="link-cell" type="button" data-category-filter="${Format.escape(category.name)}"><strong>${category.count}</strong><span>${category.published} на витрине${category.lowStock ? ` · ${category.lowStock} мало` : ""}</span></button><span>${Format.escape(category.prescription)}</span><button class="category-status" type="button" data-category-toggle="${Format.escape(category.name)}"><span class="switch ${category.online ? "on" : ""}"></span><span class="status ${category.online ? "ok" : "danger"}">${category.online ? "Разрешена" : "Отключена"}</span></button><div class="actions-cell"><button class="icon-button" type="button" data-category-filter="${Format.escape(category.name)}" title="Показать товары категории">${Ui.icon("search")}</button><button class="icon-button" type="button" data-category-toggle="${Format.escape(category.name)}" title="Изменить онлайн-продажу">${Ui.icon(category.online ? "eye-off" : "eye")}</button><button class="icon-button danger" type="button" data-category-delete="${Format.escape(category.name)}" title="${category.count ? "Сначала переместите товары" : "Удалить категорию"}">${Ui.icon("trash-2")}</button></div></div>`).join("")}</div>` : `<div class="inventory-empty compact"><span class="icon-tile">${Ui.icon("shapes")}</span><h3>Категорий пока нет</h3><p>Создайте первую категорию или добавьте товар: его категория появится здесь автоматически.</p></div>`}
      </section>
      <section class="partner-actions">
        <article class="quick-card"><span class="icon-tile">${Ui.icon("shield-alert")}</span><div><strong>Ограничения лекарств</strong><p class="muted">Рецептурные и контролируемые товары требуют отдельной проверки.</p></div></article>
        <article class="quick-card"><span class="icon-tile">${Ui.icon("badge-check")}</span><div><strong>Единый справочник</strong><p class="muted">Категории и медицинские свойства берутся из центральной карточки DoriGo.</p></div></article>
        <article class="quick-card"><span class="icon-tile">${Ui.icon("package-check")}</span><div><strong>Предложение аптеки</strong><p class="muted">Аптека добавляет цену, остаток и доставку к общей карточке товара.</p></div></article>
      </section>
    `;
    return this.layout("categories", content);
  }

  adminCatalog(state = {}) {
    const query = String(state.query || "").trim().toLowerCase();
    const filtered = this.store.catalogProducts.filter((product) => {
      if (!query) return true;
      return [
        product.name,
        product.mnn,
        product.registrationNumber,
        product.manufacturer,
        product.atcCode,
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });
    const selected = this.store.catalogProducts.find((product) => product.id === state.selectedId)
      || filtered[0]
      || this.store.catalogProducts[0]
      || null;
    const verifiedCount = this.store.catalogProducts.filter((product) => product.sourceVerified).length;
    const withImages = this.store.catalogProducts.filter((product) => Ui.productImages(product).length).length;

    const content = `
      <section class="page-title">
        <div>
          <h1>Единый каталог препаратов</h1>
          <p>Аптеки подключают цену и остаток к готовой карточке. Медицинские сведения и изображения меняет только администратор.</p>
        </div>
        <a class="btn ghost" href="https://uzpharm-control.uz/pages/state-register-of-medicines-and-medical-products" target="_blank" rel="noopener">${Ui.icon("external-link")} Официальный реестр</a>
      </section>
      <section class="metric-grid catalog-admin-metrics">
        ${this.metric("database", "Карточек в справочнике", String(this.store.catalogProducts.length), "Единые карточки")}
        ${this.metric("badge-check", "Подтверждены источником", String(verifiedCount), `${Math.max(0, this.store.catalogProducts.length - verifiedCount)} ожидают данных`, "blue")}
        ${this.metric("images", "С официальными фото", String(withImages), "Центральные галереи", "purple")}
      </section>
      <section class="catalog-admin-layout">
        <aside class="panel catalog-admin-list">
          <div class="panel-head"><div><h3>Препараты</h3><p class="muted">${filtered.length} найдено</p></div></div>
          <label class="field has-icon">${Ui.icon("search")}<input data-admin-catalog-search type="search" value="${Format.escape(state.query || "")}" placeholder="Название, МНН, регистрационный №" /></label>
          <div class="catalog-admin-items">
            ${filtered.length ? filtered.slice(0, 250).map((product) => `
              <button class="${selected?.id === product.id ? "active" : ""}" type="button" data-admin-catalog-select="${Format.escape(product.id)}">
                ${Ui.packshot(product, "small")}
                <span><strong>${Format.escape(product.name)} ${Format.escape(product.subtitle || "")}</strong><small>${Format.escape(product.mnn || "МНН не указан")}</small><small class="${product.sourceVerified ? "verified-text" : "pending-text"}">${product.sourceVerified ? "Источник подтвержден" : "Ожидает проверки"}</small></span>
              </button>
            `).join("") : `<div class="panel-empty"><p>По запросу ничего не найдено.</p></div>`}
          </div>
        </aside>
        <section class="panel catalog-admin-editor">
          ${selected ? this.adminCatalogForm(
            selected,
            state.imagesProductId === selected.id ? state.images : null,
          ) : `
            <div class="inventory-empty">
              <span class="icon-tile">${Ui.icon("database")}</span>
              <h3>Справочник пока пуст</h3>
              <p>Скачайте актуальный архив государственного реестра и выполните импорт. Непроверенные карточки автоматически не публикуются как официальные.</p>
            </div>
          `}
        </section>
      </section>
      <section class="panel registry-import-note">
        <span class="icon-tile">${Ui.icon("file-spreadsheet")}</span>
        <div><h3>Импорт государственного реестра</h3><p>Импортёр находится в <code>tools/import-uz-registry.js</code>. Он переносит только поля из официального Excel и не создаёт описания, инструкции или фотографии от себя.</p></div>
        <a class="btn ghost" href="https://www.uzpharm-control.uz/ru/pages/published-information" target="_blank" rel="noopener">Инструкции и публикации</a>
      </section>
    `;
    return this.layout("admin-catalog", content);
  }

  adminCatalogForm(product, draftImages = null) {
    const images = Array.isArray(draftImages) ? draftImages : Ui.productImages(product);
    const field = (label, name, value, type = "text") => `<label class="settings-input"><span>${label}</span><input name="${name}" type="${type}" value="${Format.escape(value || "")}" /></label>`;
    const area = (label, name, value, placeholder) => `<label class="settings-input catalog-textarea"><span>${label}</span><textarea name="${name}" rows="6" placeholder="${Format.escape(placeholder)}">${Format.escape(value || "")}</textarea></label>`;
    return `
      <form data-admin-catalog-form>
        <input type="hidden" name="productId" value="${Format.escape(product.id)}" />
        <div class="panel-head">
          <div><h3>${Format.escape(product.name)} ${Format.escape(product.subtitle || "")}</h3><p class="muted">ID: ${Format.escape(product.id)}</p></div>
          <span class="status ${product.sourceVerified ? "ok" : "warn"}">${product.sourceVerified ? "Проверено" : "Не подтверждено"}</span>
        </div>
        <div class="catalog-form-section">
          <h4>Идентификация</h4>
          <div class="settings-grid">
            ${field("Торговое название", "name", product.name)}
            ${field("МНН / действующее вещество", "mnn", product.mnn || product.ingredient)}
            ${field("Дозировка", "dosage", product.dosage)}
            ${field("Форма выпуска", "form", product.form)}
            ${field("Количество / упаковка", "packageSize", product.packageSize || "")}
            ${field("Категория", "category", product.category)}
            ${field("Производитель", "manufacturer", product.manufacturer)}
            ${field("Страна", "country", product.country)}
            ${field("Регистрационный номер", "registrationNumber", product.registrationNumber)}
            ${field("Код ATC", "atcCode", product.atcCode)}
            ${field("Дата регистрации / перерегистрации", "registrationDate", product.registrationDate)}
            ${field("Дата изменения", "registrationChangeDate", product.registrationChangeDate)}
            <label class="settings-input"><span>Условия отпуска</span><select name="prescriptionStatus"><option value="Не указано" ${product.prescriptionStatus === "Не указано" ? "selected" : ""}>Не указано</option><option value="Без рецепта" ${product.prescriptionStatus === "Без рецепта" ? "selected" : ""}>Без рецепта</option><option value="По рецепту" ${product.prescriptionStatus === "По рецепту" ? "selected" : ""}>По рецепту</option></select></label>
          </div>
          ${area("Полное торговое название из реестра", "fullTradeName", product.fullTradeName, "Название и синонимы из государственного реестра")}
          ${area("Полная форма выпуска из реестра", "dosageFormDetails", product.dosageFormDetails, "Полная дозировка, фасовка и вид упаковки")}
          ${area("Фармакотерапевтическая группа", "pharmacotherapeuticGroup", product.pharmacotherapeuticGroup, "Группа из государственного реестра")}
        </div>
        <div class="catalog-form-section">
          <h4>Официальная информация</h4>
          ${area("Описание", "description", product.description, "Текст из официальной инструкции")}
          ${area("Способ применения", "usage", product.usage, "Текст из официальной инструкции")}
          ${area("Состав", "composition", product.composition, "Действующие и вспомогательные вещества")}
          ${area("Показания", "indications", product.indications, "Показания из официальной инструкции")}
          ${area("Противопоказания", "contraindications", product.contraindications, "Противопоказания из официальной инструкции")}
          ${area("Условия хранения", "storageConditions", product.storageConditions, "Температура, свет, доступ детей")}
        </div>
        <div class="catalog-form-section">
          <h4>Источник</h4>
          <div class="settings-grid">
            ${field("Название источника", "sourceName", product.sourceName)}
            ${field("Дата обновления", "sourceUpdatedAt", String(product.sourceUpdatedAt || "").slice(0, 10), "date")}
            ${field("Ссылка на запись реестра", "sourceUrl", product.sourceUrl, "url")}
            ${field("Ссылка на официальную инструкцию", "instructionUrl", product.instructionUrl, "url")}
          </div>
          <label class="catalog-verified-check"><input name="sourceVerified" type="checkbox" ${product.sourceVerified ? "checked" : ""} /><span>${Ui.icon("badge-check")} Сведения сверены с указанным официальным источником</span></label>
        </div>
        <div class="catalog-form-section">
          <div class="panel-head"><div><h4>Центральная галерея</h4><p class="muted">До 6 изображений упаковки. Укажите источник изображений выше.</p></div><label class="btn ghost catalog-image-upload">${Ui.icon("upload")} Добавить фото<input data-admin-catalog-images type="file" accept="image/*" multiple /></label></div>
          <div class="catalog-admin-images">
            ${images.length ? images.map((image, index) => `<figure><img src="${Format.escape(image.data)}" alt="${Format.escape(image.name)}" /><button class="icon-button danger" type="button" data-admin-image-remove="${index}" title="Удалить фото">${Ui.icon("trash-2")}</button><figcaption>${Format.escape(image.name)}</figcaption></figure>`).join("") : `<div class="official-data-empty">${Ui.icon("images")} <span>Официальные фотографии ещё не добавлены.</span></div>`}
          </div>
        </div>
        <div class="catalog-editor-actions">
          <a class="btn ghost" href="#product" data-product-select="${Format.escape(product.id)}">${Ui.icon("eye")} Посмотреть карточку</a>
          <button class="btn primary" type="submit">${Ui.icon("save")} Сохранить единую карточку</button>
        </div>
      </form>
    `;
  }

  adminDashboard() {
    const admin = this.store.adminStats();
    const pharmacyRecords = this.store.accounts.marketplacePharmacies();
    const adminInventory = pharmacyRecords.flatMap(({ pharmacy }) => (pharmacy.inventory || []).map((product) => ({ product, pharmacy })));
    const adminOrders = pharmacyRecords.flatMap(({ pharmacy }) => (pharmacy.orders || []).map((order) => ({ order, pharmacy })));
    const restrictedCount = adminInventory.filter(({ product }) => product.rxRequired || Number(product.stock) <= 0 || (product.moderationStatus && product.moderationStatus !== "Активен")).length;
    const complaintCount = adminOrders.filter(({ order }) => order.status === "Отменен" || Number(order.duration) > 70).length;
    const returnCount = adminOrders.filter(({ order }) => order.status === "Отменен").length;
    const quickActions = [
      { label: "Аптеки", icon: "hospital", href: "#admin" },
      { label: "Единый каталог", icon: "database", href: "#admin-catalog" },
      { label: "Цены и акции", icon: "tag", href: "#partner-pricing" },
      { label: "Поддержка", icon: "bell", href: "#partner-support" },
      { label: "Экспорт CSV", icon: "download", action: "export" },
    ];
    const content = `
      <section class="page-title">
        <div><h1>Дашборд администратора</h1><p>Контроль аптек, товаров, заказов, курьеров и модерации.</p></div>
        <button class="date-pill">${Ui.icon("calendar")} ${new Date().toLocaleDateString("ru-RU")}</button>
      </section>
      <section class="metric-grid admin-metrics">
        ${this.metric("shield-check", "Аптеки в системе", String(admin.pharmacies), `${admin.published} активных предложений`)}
        ${this.metric("badge-check", "Требуют проверки", String(admin.needsModeration), `${admin.sku} позиций всего`, "orange")}
        ${this.metric("truck", "Курьеры онлайн", `${admin.couriers}/${admin.totalCouriers}`, `${admin.stats.courier} заказов в доставке`, "blue")}
        ${this.metric("shopping-cart", "Заказы", String(admin.stats.total), `${admin.stats.completed} доставлено`, "green")}
        ${this.metric("clock", "Комиссия платформы", Format.money(admin.commission), "7,5% от доставленных заказов", "purple")}
        ${this.metric("flame", "Низкие остатки", String(admin.lowStock + admin.outOfStock), `${admin.outOfStock} без остатка`, "red")}
      </section>
      <section class="admin-grid">
        <div class="panel"><div class="panel-head"><h3>Аптеки в системе <span class="badge red">${admin.pharmacies}</span></h3><a class="link-more" href="#admin">Все аптеки</a></div>${this.adminReviewTable()}</div>
        <div class="panel"><div class="panel-head"><h3>Товары с ограничениями <span class="badge red">${restrictedCount}</span></h3><a class="link-more" href="#admin-catalog">Все товары</a></div>${this.adminProductsTable()}</div>
        <div class="panel"><div class="panel-head"><h3>Последние жалобы клиентов <span class="badge red">${complaintCount}</span></h3><a class="link-more" href="#admin">Все жалобы</a></div>${this.complaintsTable()}</div>
        <div class="panel"><div class="panel-head"><h3>Активность курьеров</h3><a class="link-more" href="#admin">Все курьеры</a></div>${this.couriersTable()}</div>
        <div class="panel"><div class="panel-head"><h3>Возвраты и возвраты средств <span class="badge red">${returnCount}</span></h3><a class="link-more" href="#admin">Все возвраты</a></div>${this.returnsTable()}</div>
        ${this.adminRevenuePanel(admin)}
        <div class="panel"><div class="panel-head"><h3>Быстрые действия</h3></div><div class="quick-action-grid">${quickActions.map((action) => action.href ? `<a class="quick-action" href="${action.href}">${Ui.icon(action.icon)} ${action.label}</a>` : `<button class="quick-action" type="button" data-admin-export>${Ui.icon(action.icon)} ${action.label}</button>`).join("")}</div></div>
        <div class="panel"><div class="panel-head"><h3>Системные уведомления <span class="badge red">3</span></h3><a class="link-more" href="#admin">Все уведомления</a></div><div class="notifications"><div class="notification"><span>32 аптеки ожидают одобрения</span><small>10 мин назад</small></div><div class="notification warn"><span>14 товаров требуют модерации</span><small>15 мин назад</small></div><div class="notification danger"><span>18 новых жалоб от клиентов</span><small>20 мин назад</small></div></div></div>
      </section>
    `;
    return this.layout("admin", content);
  }

  metric(icon, label, value, trend, tone = "green") {
    return `<article class="metric-card"><span class="icon-tile" style="background: var(--${tone}-soft, var(--green-soft)); color: var(--${tone}, var(--green));">${Ui.icon(icon)}</span><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="trend">${trend}</div></article>`;
  }

  ordersTable(limit = this.store.orders.length) {
    const orders = this.store.orders.filter((order) => this.store.orderActionLabel(order.status)).slice(0, limit);
    return `<div class="data-table" style="border:0; border-radius:0;"><div class="table-row table-head orders"><span>N заказа</span><span>Время</span><span>Клиент</span><span>Сумма</span><span>Статус</span><span>Действия</span></div>${orders.length ? orders.map((order) => {
      const action = this.store.orderActionLabel(order.status);
      return `<div class="table-row orders"><a class="link-more" href="#partner-order" data-order-open="${Format.escape(order.id)}">#${Format.escape(order.id)}</a><span>${Format.escape(order.time)}</span><span>${Format.escape(order.client)}<br /><span class="muted">${Format.escape(order.district)}</span></span><strong>${Format.money(order.amount)}</strong><span class="status ${Ui.statusClass(order.status)}">${Format.escape(order.status)}</span><div class="actions-cell"><button class="btn small primary" data-order-action="${Format.escape(order.id)}">${action}</button></div></div>`;
    }).join("") : `<div class="panel-empty"><p>Все заказы обработаны.</p></div>`}<div class="panel-head" style="justify-content:center;"><a class="link-more" href="#partner-orders">Показать все заказы</a></div></div>`;
  }

  productsTable(products = this.store.pharmacyInventory, hasInventory = this.store.pharmacyInventory.length > 0) {
    if (!products.length) {
      if (hasInventory) {
        return `<div class="inventory-empty compact"><span class="icon-tile">${Ui.icon("search")}</span><h3>По фильтрам ничего не найдено</h3><p>Измените запрос, категорию, статус или срок годности.</p><button class="btn ghost" type="button" data-inventory-reset>${Ui.icon("rotate-ccw")} Сбросить фильтры</button></div>`;
      }
      return `<div class="inventory-empty"><span class="icon-tile">${Ui.icon("package")}</span><h3>В аптеке пока нет предложений</h3><p>Выберите препарат из единого каталога и укажите цену с остатком либо заполните Excel-шаблон.</p><div class="button-row"><button class="btn primary" data-product-add>${Ui.icon("plus")} Выбрать из каталога</button><button class="btn ghost" data-excel-template>${Ui.icon("download")} Скачать шаблон</button><button class="btn ghost" data-excel-upload>${Ui.icon("file-spreadsheet")} Загрузить Excel</button></div></div>`;
    }

    return `<div class="data-table" style="border:0; border-radius:0;"><div class="table-row table-head products"><span>Товар</span><span>Категория</span><span>Цена</span><span>Остаток</span><span>Резерв</span><span>Доступно</span><span>Срок годности</span><span>Статус</span><span>Действия</span></div>${products.map((product) => {
      const available = Math.max(0, product.stock - product.reserve);
      const published = product.published !== false;
      const status = !published ? "Скрыт" : available < 1 ? "Нет" : product.stock <= 7 ? "Мало" : "В наличии";
      return `<div class="table-row products"><div class="product-cell">${Ui.packshot(product, "small")}<span><strong>${Format.escape(product.name)} ${Format.escape(product.subtitle)}</strong><br /><span class="muted">МНН: ${Format.escape(product.mnn)}</span>${product.barcode ? `<br /><small class="muted">Штрихкод партии: ${Format.escape(product.barcode)}</small>` : ""}</span></div><span>${Format.escape(product.category)}</span><strong>${Format.money(product.price)}</strong><span>${product.stock}</span><span>${product.reserve}</span><strong>${available}</strong><span>${Format.escape(Format.expiryLabel(product.expiry))}</span><span class="status ${Ui.statusClass(status)}">${status}</span><div class="actions-cell"><button class="icon-button" type="button" data-product-edit="${Format.escape(product.catalogId)}" title="Изменить цену и остаток">${Ui.icon("pencil")}</button><button class="icon-button" data-toast="Резерв товара: ${product.reserve} шт.">${Ui.icon("package")}</button><button class="icon-button" type="button" data-product-publish="${Format.escape(product.id)}" data-published="${published ? "1" : "0"}" title="${published ? "Скрыть с витрины" : "Опубликовать на витрине"}">${Ui.icon(published ? "archive" : "eye")}</button><span class="switch ${published ? "on" : ""}"></span></div></div>`;
    }).join("")}</div>`;
  }

  deliveryStatusPanel() {
    const stats = this.store.orderStats();
    const rows = [
      ["В работе", stats.new + stats.confirmed + stats.assembly, "Активно", "warn"],
      ["У курьера", stats.courier, "В пути", "blue"],
      ["Доставлены", stats.completed, "Готово", "ok"],
      ["Отменены", stats.cancelled, "Отменен", "danger"],
    ];
    const recent = this.store.orders.filter((order) => ["Передан курьеру", "В пути", "Доставлен"].includes(order.status)).slice(0, 3);
    return `<div class="panel"><div class="panel-head"><h3>Статус доставок</h3><a class="link-more" href="#partner-orders">Смотреть все</a></div><div class="delivery-status-grid">${rows.map(([label, value, status, tone]) => `<article><span>${label}</span><strong>${value}</strong><span class="status ${tone}">${status}</span></article>`).join("")}</div>${recent.length ? `<div class="small-list">${recent.map((order) => `<div class="small-row" style="grid-template-columns:100px 1fr auto;"><a class="link-more" href="#partner-order" data-order-open="${Format.escape(order.id)}">#${Format.escape(order.id)}</a><span>${Format.escape(order.client)}</span><strong>${Format.money(order.amount)}</strong></div>`).join("")}</div>` : `<div class="panel-empty"><p>Активных доставок пока нет.</p></div>`}</div>`;
  }

  partnerOrdersFullTable(orders = this.store.orders, state = {}) {
    if (!this.store.selectedPartnerOrders) this.store.selectedPartnerOrders = new Set();
    const selected = this.store.selectedPartnerOrders;
    const existingIds = new Set(this.store.orders.map((order) => order.id));
    [...selected].forEach((id) => {
      if (!existingIds.has(id)) selected.delete(id);
    });

    const pageSize = Math.max(5, Number(state.pageSize) || 10);
    const totalPages = Math.max(1, Math.ceil(orders.length / pageSize));
    const currentPage = Math.min(totalPages, Math.max(1, Number(state.page) || 1));
    const pageStart = (currentPage - 1) * pageSize;
    const visibleOrders = orders.slice(pageStart, pageStart + pageSize);
    const visibleIds = visibleOrders.map((order) => order.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
    const paginationItems = [...new Set([
      1,
      currentPage - 1,
      currentPage,
      currentPage + 1,
      totalPages,
    ].filter((page) => page >= 1 && page <= totalPages))].sort((a, b) => a - b);
    const paginationMarkup = paginationItems.map((page, index) => {
      const previousPage = paginationItems[index - 1];
      const gap = previousPage && page - previousPage > 1 ? `<span class="pagination-gap" aria-hidden="true">...</span>` : "";
      return `${gap}<button type="button" data-order-page="${page}" class="${page === currentPage ? "active" : ""}" ${page === currentPage ? 'aria-current="page"' : ""}>${page}</button>`;
    }).join("");
    const shownFrom = orders.length ? pageStart + 1 : 0;
    const shownTo = Math.min(pageStart + pageSize, orders.length);
    const selectionToolbar = selected.size ? `
      <div class="bulk-toolbar">
        <strong>Выбрано: ${selected.size}</strong>
        <button class="btn small primary" type="button" data-order-bulk="advance">${Ui.icon("arrow-right")} Следующий этап</button>
        <button class="btn small ghost danger-action" type="button" data-order-bulk="cancel">${Ui.icon("x")} Отменить</button>
        <button class="btn small ghost" type="button" data-order-bulk="clear">Снять выбор</button>
      </div>
    ` : "";

    return `
      <div class="data-table" style="border:0; border-radius:0;">
        ${selectionToolbar}
        <div class="table-row table-head partner-orders">
          <label class="table-check">
            <input type="checkbox" data-order-select-page aria-label="Выбрать заказы на странице" ${allVisibleSelected ? "checked" : ""} ${visibleIds.length ? "" : "disabled"} />
          </label>
          <span>N заказа</span>
          <span>Дата и время</span>
          <span>Клиент</span>
          <span>Товары</span>
          <span>Тип</span>
          <span>Сумма</span>
          <span>Оплата</span>
          <span>Статус</span>
          <span>Действия</span>
        </div>
        ${visibleOrders.length ? visibleOrders.map((order) => {
          const action = this.store.orderActionLabel(order.status);
          const checked = selected.has(order.id) ? "checked" : "";
          return `
            <div class="table-row partner-orders">
              <label class="table-check">
                <input type="checkbox" data-order-select="${Format.escape(order.id)}" aria-label="Выбрать заказ ${Format.escape(order.id)}" ${checked} />
              </label>
              <a class="link-more" href="#partner-order" data-order-open="${Format.escape(order.id)}">#${Format.escape(order.id)}</a>
              <span>${Format.escape(order.date || "")}<br /><strong>${Format.escape(order.time || "")}</strong></span>
              <span>${Format.escape(order.client)}<br /><span class="muted">${Format.escape(order.phone || "")}</span></span>
              <strong>${order.itemCount || 0} товара</strong>
              <span>${Ui.icon(order.type === "Самовывоз" ? "shopping-bag" : "bike")} ${Format.escape(order.type || "Доставка")}</span>
              <strong>${Format.money(order.amount)}</strong>
              <span>${Ui.icon(order.payment === "Наличные" ? "banknote" : "credit-card")} ${Format.escape(order.payment || "Не указано")}</span>
              <span class="status ${Ui.statusClass(order.status)}">${Format.escape(order.status)}</span>
              <div class="actions-cell">${action ? `<button class="btn small primary" data-order-action="${Format.escape(order.id)}">${action}</button>` : ""}<a class="icon-button" href="#partner-order" data-order-open="${Format.escape(order.id)}" title="Открыть заказ">${Ui.icon("chevron-right")}</a></div>
            </div>
          `;
        }).join("") : `
          <div class="inventory-empty compact orders-empty-state">
            <span class="icon-tile">${Ui.icon("shopping-bag")}</span>
            <h3>Заказы не найдены</h3>
            <p>Измените фильтры или оформите заказ на витрине, чтобы проверить цепочку клиент - аптека - курьер.</p>
            <div class="button-row">
              <a class="btn primary" href="#home">${Ui.icon("store")} Открыть витрину</a>
              <a class="btn ghost" href="#inventory">${Ui.icon("package-search")} Проверить товары</a>
              <button class="btn ghost" type="button" data-order-reset>${Ui.icon("rotate-ccw")} Сбросить фильтры</button>
            </div>
          </div>
        `}
        <div class="catalog-pagination-wrap order-pagination">
          <p class="pagination-summary">Показано ${shownFrom}-${shownTo} из ${orders.length}</p>
          <nav class="pagination" aria-label="Страницы заказов">
            <button type="button" data-order-page="${currentPage - 1}" aria-label="Предыдущая страница" ${currentPage === 1 ? "disabled" : ""}>${Ui.icon("chevron-left")}</button>
            ${paginationMarkup}
            <button type="button" data-order-page="${currentPage + 1}" aria-label="Следующая страница" ${currentPage === totalPages ? "disabled" : ""}>${Ui.icon("chevron-right")}</button>
          </nav>
          <label class="page-size-control">Показывать по:<select class="select-pill" data-order-page-size><option value="10" ${pageSize === 10 ? "selected" : ""}>10</option><option value="20" ${pageSize === 20 ? "selected" : ""}>20</option><option value="50" ${pageSize === 50 ? "selected" : ""}>50</option></select></label>
          <span class="status ok">Данные синхронизированы</span>
        </div>
      </div>
    `;
  }

  pricingTable(products = this.store.pharmacyInventory, totalProducts = products.length) {
    if (!products.length) return `<div class="inventory-empty compact"><span class="icon-tile">${Ui.icon("tag")}</span><h3>Прайс-лист пуст</h3><p>Сначала добавьте товары на странице «Товары и остатки».</p><a class="btn primary" href="#inventory">Перейти к товарам</a></div>`;
    return `<div class="data-table pricing-data-table" style="border:0; border-radius:0;"><div class="table-row table-head pricing"><span>Товар</span><span>Категория</span><span>Закупочная цена</span><span>Цена продажи</span><span>Средняя по рынку</span><span>Маржа</span><span>Статус</span><span>Действие</span></div>${products.map((product) => {
      const pricing = this.store.productPricing(product);
      const status = pricing.promotion ? `Скидка ${pricing.promotion.discount}%` : pricing.aboveMarket ? "Выше рынка" : "Обычная цена";
      return `<form class="table-row pricing pricing-row-form" data-price-form="${Format.escape(product.id)}"><div class="product-cell">${Ui.packshot(product, "small")}<span><strong>${Format.escape(product.name)} ${Format.escape(product.subtitle || "")}</strong><br /><span class="muted">МНН: ${Format.escape(product.mnn || "")}</span></span></div><span>${Format.escape(product.category)}</span><label class="price-cell"><input name="purchasePrice" type="number" min="0" step="100" value="${pricing.purchasePrice}" aria-label="Закупочная цена ${Format.escape(product.name)}" /></label><label class="price-cell"><input name="salePrice" type="number" min="100" step="100" value="${pricing.salePrice}" aria-label="Цена продажи ${Format.escape(product.name)}" />${pricing.promotion ? `<small>Базовая: ${Format.money(product.basePrice)}</small>` : ""}</label><strong>${Format.money(pricing.marketPrice)}</strong><strong class="${pricing.margin >= 0 ? "trend" : "danger-text"}">${pricing.margin}%</strong><span class="status ${pricing.promotion ? "ok" : pricing.aboveMarket ? "warn" : "blue"}">${status}</span><button class="btn small ghost" type="submit">${Ui.icon("save")} Сохранить</button></form>`;
    }).join("")}<div class="panel-head pricing-table-footer"><span class="muted">Показано ${products.length} из ${totalProducts}</span><span class="status ok">Цены каталога актуальны</span></div></div>`;
  }

  replacementCard(title, options) {
    return `<div class="replacement-card"><strong>${title}</strong><p class="danger-text">Нет в наличии</p><span>Предложить замену:</span>${options.map((option, index) => `<label class="check-row"><input type="radio" name="${title}" ${index === 0 ? "checked" : ""} /> ${option}</label>`).join("")}<a class="link-more" href="#partner-order">Показать ещё варианты</a></div>`;
  }

  simpleRows(rows, headers) {
    return `<div class="data-table compact-table" style="--cols:${headers.length}; border:0; border-radius:0;"><div class="table-row table-head">${headers.map((header) => `<span>${header}</span>`).join("")}</div>${rows.map((row) => `<div class="table-row">${row.split("|").map((cell) => `<span class="${["Высокий", "Новый", "Ошибка"].includes(cell) ? "status danger" : ["Средний", "Нужен ответ", "Ожидает клиента", "Ограничено"].includes(cell) ? "status warn" : ["Решено", "Проверено", "Да"].includes(cell) ? "status ok" : ""}">${cell}</span>`).join("")}</div>`).join("")}</div>`;
  }

  lowStockPanel(compact = false) {
    const rows = this.store.pharmacyInventory.filter((product) => product.stock <= 7).slice(0, compact ? 4 : 5);
    return `<div class="panel"><div class="panel-head"><h3>Низкие остатки</h3><a class="link-more" href="#inventory">Все товары</a></div>${rows.length ? `<div class="small-list">${rows.map((product) => `<div class="small-row">${Ui.packshot(product, "small")}<div><strong>${Format.escape(product.name)} ${Format.escape(product.subtitle)}</strong><p class="muted">Остаток: ${product.stock} шт.</p></div><button class="btn small ghost" type="button" data-product-edit="${Format.escape(product.catalogId || product.id)}">Пополнить</button></div>`).join("")}</div>` : `<div class="panel-empty"><span>${Ui.icon("package-check")}</span><p>Товаров с низким остатком пока нет.</p></div>`}</div>`;
  }

  revenuePanel(title = "Выручка", value = null) {
    const stats = this.store.orderStats(this.store.analyticsOrders("7"));
    const displayValue = value || Format.money(stats.revenue);
    return `<div class="panel"><div class="panel-head"><h3>${title}</h3><span class="status ok">7 дней</span></div><div class="chart"><div class="metric-value">${displayValue}</div><div class="muted">${stats.completed} доставленных заказов · средний чек ${Format.money(stats.completed ? Math.round(stats.revenue / stats.completed) : 0)}</div><div class="chart-line"></div></div></div>`;
  }

  adminRevenuePanel(admin) {
    const averageCheck = admin.stats.completed ? Math.round(admin.revenue / admin.stats.completed) : 0;
    return `
      <div class="panel admin-revenue-panel">
        <div class="panel-head"><h3>Комиссии и доходы</h3><span class="status ok">live</span></div>
        <div class="chart">
          <div class="metric-value">${Format.money(admin.revenue)}</div>
          <div class="muted">${admin.stats.completed} доставленных заказов · комиссия ${Format.money(admin.commission)}</div>
          <div class="chart-line"></div>
        </div>
        <div class="admin-revenue-grid">
          <span><small>К выплате аптекам</small><strong>${Format.money(Math.max(0, admin.revenue - admin.commission))}</strong></span>
          <span><small>Активные заказы</small><strong>${Format.money(admin.activeRevenue)}</strong></span>
          <span><small>Средний чек</small><strong>${Format.money(averageCheck)}</strong></span>
          <span><small>Низкие остатки</small><strong>${admin.lowStock + admin.outOfStock}</strong></span>
        </div>
      </div>
    `;
  }

  popularPanel() {
    const sales = new Map();
    this.store.orders.filter((order) => order.status === "Доставлен").forEach((order) => {
      sales.set(order.productName, (sales.get(order.productName) || 0) + Number(order.itemCount || 0));
    });
    const products = this.store.pharmacyInventory
      .map((product) => ({ product, sold: sales.get(product.name) || sales.get(`${product.name} ${product.dosage || ""}`.trim()) || 0 }))
      .sort((a, b) => b.sold - a.sold || b.product.stock - a.product.stock)
      .slice(0, 5);
    return `<div class="panel"><div class="panel-head"><h3>Популярные товары</h3><a class="link-more" href="#inventory">Все товары</a></div>${products.length ? `<div class="small-list">${products.map(({ product, sold }, index) => `<div class="small-row" style="grid-template-columns: 24px 64px 1fr;"><strong>${index + 1}</strong>${Ui.packshot(product, "small")}<div><strong>${Format.escape(product.name)}</strong><p class="muted">Продано: ${sold} шт. · остаток: ${product.stock} шт.</p></div></div>`).join("")}</div>` : `<div class="panel-empty"><p>Добавьте товары, чтобы увидеть рейтинг ассортимента.</p></div>`}</div>`;
  }

  syncPanel() {
    const rows = this.store.syncEvents().slice(0, 8);
    return `<div class="panel"><div class="panel-head"><h3>Журнал синхронизации и загрузок</h3><button class="btn small ghost" type="button" data-inventory-refresh>${Ui.icon("refresh-cw")} Обновить</button></div>${rows.length ? `<div class="small-list">${rows.map((row) => `<div class="small-row sync-row"><span class="icon-tile">${Ui.icon(["Ошибка", "С ошибками"].includes(row.status) ? "circle-alert" : "refresh-cw")}</span><div><strong>${Format.escape(row.title)}</strong>${row.details ? `<p class="muted">${Format.escape(row.details)}</p>` : ""}</div><span>${Format.escape(Format.dateTime(row.createdAt))}</span><span class="status ${Ui.statusClass(row.status)}">${Format.escape(row.status)}</span></div>`).join("")}</div>` : `<div class="panel-empty"><span>${Ui.icon("refresh-cw")}</span><p>Журнал появится после добавления товара, Excel-импорта, изменения цен или обновления остатков.</p></div>`}</div>`;
  }

  adminReviewTable() {
    const rows = this.store.accounts.marketplacePharmacies().slice(0, 8);
    if (!rows.length) return `<div class="panel-empty"><span>${Ui.icon("hospital")}</span><p>Зарегистрированных аптек пока нет.</p></div>`;
    return `<div class="data-table" style="border:0;"><div class="table-row table-head admin-review"><span>Аптека</span><span>Город / Район</span><span>Дата регистрации</span><span>Документы</span><span>Действие</span></div>${rows.map(({ pharmacy }) => {
      const documentCount = Array.isArray(pharmacy.documents) ? pharmacy.documents.length : 0;
      const docs = documentCount >= 2 ? "Проверено" : documentCount ? "На проверке" : "Нет документов";
      return `<div class="table-row admin-review"><strong>${Format.escape(pharmacy.name)}</strong><span>${Format.escape(pharmacy.city || "Ташкент")}<br /><span class="muted">${Format.escape(pharmacy.district || "")}</span></span><span>${Format.escape(Format.dateTime(pharmacy.createdAt || new Date()))}</span><span class="status ${documentCount >= 2 ? "ok" : documentCount ? "warn" : "danger"}">${docs}</span><div class="actions-cell"><a class="btn small ghost" href="#admin-catalog">Каталог</a><a class="btn small ghost" href="#partner-settings">Профиль</a></div></div>`;
    }).join("")}</div>`;
  }

  adminProductsTable() {
    const rows = this.store.accounts.marketplacePharmacies()
      .flatMap(({ pharmacy }) => (pharmacy.inventory || []).map((product) => ({ product, pharmacy })))
      .filter(({ product }) => product.rxRequired || Number(product.stock) <= 0 || (product.moderationStatus && product.moderationStatus !== "Активен"))
      .slice(0, 8);
    if (!rows.length) return `<div class="panel-empty"><span>${Ui.icon("shield-check")}</span><p>Ограниченных товаров пока нет.</p></div>`;
    return `<div class="data-table" style="border:0;"><div class="table-row table-head admin-products"><span>Товар</span><span>Аптека</span><span>Причина</span><span>Действие</span></div>${rows.map(({ product, pharmacy }) => {
      const reason = product.moderationStatus && product.moderationStatus !== "Активен"
        ? product.moderationStatus
        : Number(product.stock) <= 0
          ? "Нет в наличии"
          : product.rxRequired
            ? "Рецептурный"
            : "Контроль";
      const needsReview = product.moderationStatus && product.moderationStatus !== "Активен";
      const lockedLabel = Number(product.stock) <= 0 ? "Нужен остаток" : product.rxRequired ? "По рецепту" : "Проверено";
      const action = needsReview
        ? `<button class="btn small ghost" type="button" data-admin-product-approve="${Format.escape(product.id)}" data-admin-pharmacy-id="${Format.escape(pharmacy.id)}">Разрешить</button>`
        : `<button class="btn small ghost" type="button" disabled>${lockedLabel}</button>`;
      return `<div class="table-row admin-products"><strong>${Format.escape(product.name)} ${Format.escape(product.dosage || "")}</strong><span>${Format.escape(pharmacy.name)}</span><span class="status ${Ui.statusClass(reason)}">${Format.escape(reason)}</span><div class="actions-cell"><a class="btn small ghost" href="#admin-catalog">Проверить</a>${action}</div></div>`;
    }).join("")}</div>`;
  }

  complaintsTable() {
    const rows = this.store.accounts.marketplacePharmacies()
      .flatMap(({ pharmacy }) => (pharmacy.orders || []).map((order) => ({ order, pharmacy })))
      .filter(({ order }) => order.status === "Отменен" || Number(order.duration) > 70)
      .slice(0, 8);
    if (!rows.length) return `<div class="panel-empty"><span>${Ui.icon("check-circle")}</span><p>Жалоб по заказам пока нет.</p></div>`;
    return `<div class="data-table" style="border:0;"><div class="table-row table-head complaints"><span>N жалобы</span><span>Клиент</span><span>Аптека</span><span>Тема</span><span>Статус</span></div>${rows.map(({ order, pharmacy }, index) => {
      const topic = order.status === "Отменен" ? "Отмена заказа" : "Задержка доставки";
      const status = order.status === "Отменен" ? "Нужен ответ" : "В работе";
      return `<div class="table-row complaints"><span>#C-${String(index + 1).padStart(4, "0")}</span><span>${Format.escape(order.client || "Клиент")}</span><span>${Format.escape(pharmacy.name)}</span><span>${topic}</span><span class="status ${Ui.statusClass(status)}">${status}</span></div>`;
    }).join("")}</div>`;
  }

  couriersTable() {
    const rows = this.store.courierRoster();
    return `<div class="data-table" style="border:0;"><div class="table-row table-head couriers"><span>Курьер</span><span>Статус</span><span>Транспорт</span><span>Активно</span><span>Сегодня</span><span>Доход</span></div>${rows.map((courier) => `<div class="table-row couriers"><strong>${Format.escape(courier.name)}</strong><span class="status ${Ui.statusClass(courier.status)}">${Format.escape(courier.status)}</span><span>${Format.escape(courier.transport)}</span><strong>${courier.active}</strong><span>${courier.deliveredToday}</span><strong>${Format.money(courier.earningsToday)}</strong></div>`).join("")}</div>`;
  }

  returnsTable() {
    const rows = this.store.accounts.marketplacePharmacies()
      .flatMap(({ pharmacy }) => (pharmacy.orders || []).map((order) => ({ order, pharmacy })))
      .filter(({ order }) => order.status === "Отменен")
      .slice(0, 8);
    if (!rows.length) return `<div class="panel-empty"><span>${Ui.icon("undo-2")}</span><p>Возвратов по отмененным заказам пока нет.</p></div>`;
    return `<div class="data-table" style="border:0;"><div class="table-row table-head returns"><span>N заявки</span><span>Клиент</span><span>Аптека</span><span>Сумма</span><span>Статус</span></div>${rows.map(({ order, pharmacy }, index) => `<div class="table-row returns"><span>#R-${String(index + 1).padStart(4, "0")}</span><span>${Format.escape(order.client || "Клиент")}</span><span>${Format.escape(pharmacy.name)}</span><strong>${Format.money(order.amount || 0)}</strong><span class="status warn">На рассмотрении</span></div>`).join("")}</div>`;
  }

  simpleAdminTable(rows, type, headers) {
    return `<div class="data-table" style="border:0;"><div class="table-row table-head ${type}">${headers.map((h) => `<span>${h}</span>`).join("")}</div>${rows.map((row) => `<div class="table-row ${type}">${row.split("|").map((cell, index, cells) => index === cells.length - 1 ? `<span class="status ${Ui.statusClass(cell)}">${cell}</span>` : `<span>${cell}</span>`).join("")}</div>`).join("")}</div>`;
  }
}

class CourierView {
  constructor(store) {
    this.store = store;
    this.activeTab = "deliveries";
    this.filter = "all";
  }

  render() {
    const orders = this.store.courierOrders();
    const filtered = this.filteredOrders(orders);
    const selected = this.store.currentCourierOrder();
    const stats = this.store.courierStats();
    const profile = this.store.courierProfile;
    const nav = [
      ["deliveries", "Доставки", "package-check"],
      ["map", "Маршрут", "map"],
      ["income", "Доход", "wallet"],
      ["notifications", "События", "bell"],
      ["profile", "Профиль", "user"],
    ];
    const mainContent = this.activeTab === "income"
      ? this.incomeWorkspace()
      : this.activeTab === "notifications"
        ? this.notificationsWorkspace()
        : this.activeTab === "profile"
          ? this.profileWorkspace()
          : this.routeWorkspace(selected);
    return `
      <div class="courier-app-page">
        <header class="courier-app-topbar">
          <div class="container courier-app-head">
            <div class="courier-app-brand">${Ui.brand()}<span class="courier-pill">Courier</span></div>
            <div class="courier-shift-card">
              <span class="courier-avatar small">${Format.escape(profile.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase())}</span>
              <div><strong>${Format.escape(profile.name)}</strong><small>${Format.escape(profile.transport)}${profile.vehicleNumber ? ` · ${Format.escape(profile.vehicleNumber)}` : ""}</small></div>
              <span class="status ${profile.online ? "ok" : "muted"}">${profile.online ? "Онлайн" : "Офлайн"}</span>
            </div>
          </div>
        </header>
        <main class="container courier-workspace">
          <section class="courier-hero-panel">
            <div>
              <span class="geo-pill">${Ui.icon("refresh-cw")} Синхронизировано с заказами аптек</span>
              <h1>Рабочая смена курьера</h1>
              <p class="muted">Маршруты строятся из сохранённой точки аптеки и точки доставки клиента. При изменении координат аптеки активные доставки пересчитываются автоматически.</p>
            </div>
            <div class="courier-nav-tabs">
              ${nav.map(([key, label, icon]) => `<button class="${this.activeTab === key ? "active" : ""}" type="button" data-courier-tab="${key}">${Ui.icon(icon)} ${label}</button>`).join("")}
            </div>
          </section>
          <section class="courier-kpi-grid">
            <article><span>${Ui.icon("package-check")}</span><strong>${stats.active}</strong><small>активные доставки</small></article>
            <article><span>${Ui.icon("bike")}</span><strong>${orders.filter((order) => order.status === "В пути").length}</strong><small>в пути сейчас</small></article>
            <article><span>${Ui.icon("route")}</span><strong>${stats.distance.toFixed(1)} км</strong><small>общий маршрут</small></article>
            <article><span>${Ui.icon("wallet")}</span><strong>${Format.money(stats.todayEarnings)}</strong><small>доход сегодня</small></article>
          </section>
          <section class="courier-workspace-grid">
            <aside class="courier-panel courier-orders-panel">
              <div class="panel-head slim"><div><h3>Очередь доставок</h3><p class="muted">${filtered.length} из ${orders.length}</p></div><button class="icon-button" type="button" data-courier-refresh title="Обновить">${Ui.icon("refresh-cw")}</button></div>
              ${this.filters()}
              <div class="courier-task-list">${this.orderCards(filtered, selected)}</div>
            </aside>
            <section class="courier-panel courier-main-panel">${mainContent}</section>
            <aside class="courier-panel courier-actions-panel">${this.actionWorkspace(selected)}</aside>
          </section>
        </main>
      </div>
    `;
  }

  filteredOrders(orders) {
    return orders.filter((order) => {
      if (this.filter === "active") return order.status !== "Доставлен";
      if (this.filter === "way") return order.status === "В пути";
      if (this.filter === "done") return order.status === "Доставлен";
      return true;
    });
  }

  filters() {
    const orders = this.store.courierOrders();
    const counts = {
      all: orders.length,
      active: orders.filter((order) => order.status !== "Доставлен").length,
      way: orders.filter((order) => order.status === "В пути").length,
      done: orders.filter((order) => order.status === "Доставлен").length,
    };
    return `<div class="courier-filter-tabs">${[
      ["all", `Все ${counts.all}`],
      ["active", `Активные ${counts.active}`],
      ["way", `В пути ${counts.way}`],
      ["done", `Готово ${counts.done}`],
    ].map(([key, label]) => `<button class="${this.filter === key ? "active" : ""}" type="button" data-courier-filter="${key}">${label}</button>`).join("")}</div>`;
  }

  orderCards(orders, selected) {
    if (!orders.length) {
      return `<div class="courier-empty"><span class="icon-tile">${Ui.icon("package")}</span><strong>Нет доставок</strong><p class="muted">Новые задачи появятся здесь сразу после того, как аптека переведёт заказ в статус «Передан курьеру».</p><div class="courier-empty-actions"><a class="btn ghost small" href="#partner-orders">${Ui.icon("clipboard-list")} Заказы аптеки</a><button class="btn ghost small" type="button" data-courier-refresh>${Ui.icon("refresh-cw")} Обновить</button></div></div>`;
    }
    return orders.map((order) => `
      <button class="courier-task-card ${selected?.id === order.id ? "active" : ""}" type="button" data-courier-order="${Format.escape(order.id)}">
        <div class="courier-task-top"><strong>#${Format.escape(order.id)}</strong><span class="status ${Ui.statusClass(order.status)}">${Format.escape(order.status)}</span></div>
        <p>${Format.escape(order.pharmacyName || "Аптека")} → ${Format.escape(order.client || "Клиент")}</p>
        <small>${Ui.icon("map-pin")} ${Format.escape(order.address || "Адрес клиента не указан")}</small>
        <div class="courier-task-meta"><span>${Number(order.distance || 0).toFixed(1)} км</span><span>${Number(order.duration) || 0} мин</span><span>${Format.money(this.store.courierFee(order))}</span></div>
      </button>
    `).join("");
  }

  routeData(order) {
    if (!order) return null;
    const pharmacy = {
      latitude: Number(order.pharmacyLatitude) || 41.3111,
      longitude: Number(order.pharmacyLongitude) || 69.2797,
    };
    const client = {
      latitude: Number(order.clientLatitude) || 41.3111,
      longitude: Number(order.clientLongitude) || 69.2797,
    };
    return {
      pharmacy,
      client,
      center: {
        latitude: (pharmacy.latitude + client.latitude) / 2,
        longitude: (pharmacy.longitude + client.longitude) / 2,
      },
      route: this.store.googleRouteUrl(pharmacy, client),
    };
  }

  routeProgress(order) {
    const activeIndex = order.status === "Доставлен" ? 2 : order.status === "В пути" ? 1 : 0;
    const steps = [
      ["package-check", "Забрать", "Товар у аптеки"],
      ["navigation", "В пути", "Курьер едет к клиенту"],
      ["check-circle", "Доставить", "Подтвердить вручение"],
    ];
    return `<div class="courier-route-progress">${steps.map(([icon, title, subtitle], index) => {
      const state = index < activeIndex ? "done" : index === activeIndex ? "current" : "";
      return `<article class="${state}"><span>${Ui.icon(icon)}</span><strong>${title}</strong><small>${subtitle}</small></article>`;
    }).join("")}</div>`;
  }

  historyEntries(order, limit = 6) {
    const fallback = [{
      id: `courier-hist-${order?.id || "order"}-created`,
      icon: "shopping-bag",
      title: "Заказ создан",
      details: `${order?.pharmacyName || "Аптека"} → ${order?.client || "Клиент"}`,
      status: order?.status || "",
      actor: order?.client || "Пациент",
      createdAt: order?.createdAt || order?.updatedAt || new Date().toISOString(),
    }];
    return (Array.isArray(order?.statusHistory) && order.statusHistory.length ? order.statusHistory : fallback)
      .slice()
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
      .slice(0, limit);
  }

  historyPanel(order) {
    const entries = this.historyEntries(order, 7);
    return `
      <section class="courier-history-card">
        <div class="courier-section-head compact">
          <div><h2>История заказа</h2><p class="muted">События синхронизированы с аптекой и пациентом.</p></div>
          <span class="status blue">${entries.length}</span>
        </div>
        <div class="courier-history-timeline">
          ${entries.map((entry) => `
            <article>
              <span class="icon-tile">${Ui.icon(entry.icon || "clock")}</span>
              <div>
                <strong>${Format.escape(entry.title || "Событие заказа")}</strong>
                <p>${Format.escape(entry.details || "")}</p>
                <small>${Format.escape([entry.actor, entry.status, Format.dateTime(entry.createdAt || new Date())].filter(Boolean).join(" · "))}</small>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  phoneHistory(order) {
    const entries = this.historyEntries(order, 4);
    return `
      <div class="phone-card courier-phone-history">
        <div class="delivery-top"><h3>История</h3><span class="muted">${entries.length}</span></div>
        ${entries.map((entry) => `
          <div>
            <span class="icon-tile">${Ui.icon(entry.icon || "clock")}</span>
            <p><strong>${Format.escape(entry.title || "Событие")}</strong><small>${Format.escape(Format.dateTime(entry.createdAt || new Date()))}</small></p>
          </div>
        `).join("")}
      </div>
    `;
  }

  routeWorkspace(order) {
    if (!order) {
      return `<div class="courier-empty large"><span class="icon-tile">${Ui.icon("map")}</span><h2>Маршрут пока не назначен</h2><p class="muted">Когда аптека передаст заказ курьеру, здесь появятся точки забора и доставки, расстояние, время в пути и ссылка на Google Maps.</p><div class="courier-empty-actions"><a class="btn ghost" href="#partner-orders">${Ui.icon("clipboard-list")} Открыть заказы аптеки</a><button class="btn primary" type="button" data-courier-tab="profile">${Ui.icon("user")} Профиль курьера</button></div></div>`;
    }
    const route = this.routeData(order);
    return `
      <div class="courier-route-head">
        <div><span class="status ${Ui.statusClass(order.status)}">${Format.escape(order.status)}</span><h2>Маршрут #${Format.escape(order.id)}</h2><p class="muted">${Format.escape(order.pharmacyName || "Аптека")} → ${Format.escape(order.client || "Клиент")}</p></div>
        <a class="btn primary" href="${Format.escape(route.route)}" target="_blank" rel="noopener">${Ui.icon("navigation")} Открыть навигатор</a>
      </div>
      ${this.routeProgress(order)}
      <div class="courier-live-map">
        ${Ui.mapSurface({
          latitude: route.center.latitude,
          longitude: route.center.longitude,
          zoom: 12,
          className: "courier-desktop-map",
          label: "Рабочий маршрут курьера",
          route: true,
          markers: [
            { latitude: route.pharmacy.latitude, longitude: route.pharmacy.longitude, type: "pharmacy", icon: "hospital", label: order.pharmacyName || "Аптека", active: true },
            { latitude: route.client.latitude, longitude: route.client.longitude, type: "client", icon: "map-pin", label: order.address || order.client },
          ],
        })}
      </div>
      <div class="courier-route-points">
        <article><span class="route-point pharmacy">${Ui.icon("hospital")}</span><div><small>Забрать в аптеке</small><strong>${Format.escape(order.pharmacyName || "Аптека")}</strong><p>${Format.escape(order.pharmacyAddress || "Адрес аптеки")}</p></div></article>
        <article><span class="route-point client">${Ui.icon("map-pin")}</span><div><small>Доставить клиенту</small><strong>${Format.escape(order.client || "Клиент")}</strong><p>${Format.escape(order.address || "Адрес клиента")}</p></div></article>
      </div>
      <div class="courier-route-metrics">
        <span><strong>${Number(order.distance || 0).toFixed(1)} км</strong><small>расстояние</small></span>
        <span><strong>${Number(order.duration) || 0} мин</strong><small>в пути</small></span>
      </div>
      ${this.historyPanel(order)}
    `;
  }

  actionWorkspace(order) {
    if (!order) {
      return `<div class="courier-empty"><span class="icon-tile">${Ui.icon("check-circle")}</span><strong>Нет выбранного заказа</strong><p class="muted">Выберите доставку из очереди.</p></div>`;
    }
    const items = (order.items || []).map((item) => `<div class="mini-product" style="grid-template-columns:42px 1fr auto;">${Ui.packshot(item, "small")}<span><strong>${Format.escape(item.name)}</strong><small class="muted">${Format.escape(item.subtitle || "")}</small></span><span>${Number(item.quantity) || 1} уп.</span></div>`).join("");
    const contactValue = String(order.phone || "").trim();
    const contactUrl = contactValue.includes("@") ? `mailto:${contactValue}` : `tel:${contactValue}`;
    const route = this.routeData(order);
    const primaryAction = order.status === "Передан курьеру"
      ? `<button class="btn primary" type="button" data-courier-pickup="${Format.escape(order.id)}">${Ui.icon("package-check")} Забрал заказ</button>`
      : order.status === "В пути"
        ? `<button class="btn primary" type="button" data-courier-deliver="${Format.escape(order.id)}">${Ui.icon("check-circle")} Доставил</button>`
        : `<span class="status ok">${Ui.icon("check-circle")} Доставка завершена</span>`;
    return `
      <div class="courier-action-title"><h3>Действия</h3><span class="status ${Ui.statusClass(order.status)}">${Format.escape(order.status)}</span></div>
      <div class="courier-action-stack">
        <div class="courier-action-card"><small>Клиент</small><strong>${Format.escape(order.client || "Клиент")}</strong><span>${Format.escape(order.phone || "Телефон не указан")}</span></div>
        <div class="courier-action-card"><small>К оплате</small><strong>${Format.money(order.amount)}</strong><span>${Format.escape(order.payment || "Способ оплаты не указан")}</span></div>
      </div>
      <div class="courier-order-items">${items || '<p class="muted">Состав заказа не указан.</p>'}</div>
      ${order.status === "В пути" ? `
        <div class="courier-code-block">
          <strong>Код клиента</strong>
          <div class="code-boxes courier-code"><input inputmode="numeric" maxlength="1" aria-label="Первая цифра" /><input inputmode="numeric" maxlength="1" aria-label="Вторая цифра" /><input inputmode="numeric" maxlength="1" aria-label="Третья цифра" /><input inputmode="numeric" maxlength="1" aria-label="Четвертая цифра" /><span>${Ui.icon("check")}</span></div>
        </div>
        <input class="visually-hidden-file" id="courier-photo-desktop-${Format.escape(order.id)}" data-courier-photo="${Format.escape(order.id)}" type="file" accept="image/*" capture="environment" />
        <label class="btn ghost courier-photo-button" for="courier-photo-desktop-${Format.escape(order.id)}">${Ui.icon("camera")} ${order.deliveryPhotoData ? "Заменить фото вручения" : "Добавить фото вручения"}</label>
        <textarea class="courier-note-area" data-courier-note placeholder="Примечание к доставке">${Format.escape(order.courierNote || "")}</textarea>
      ` : ""}
      <div class="courier-action-buttons">
        ${primaryAction}
        ${route ? `<a class="btn ghost" href="${Format.escape(route.route)}" target="_blank" rel="noopener">${Ui.icon("navigation")} Навигатор</a>` : ""}
        ${contactValue ? `<a class="btn ghost" href="${Format.escape(contactUrl)}">${Ui.icon(contactValue.includes("@") ? "mail" : "phone")} Связаться</a>` : ""}
      </div>
    `;
  }

  incomeWorkspace() {
    const stats = this.store.courierStats();
    const payout = this.store.courierPayoutSummary();
    const delivered = this.store.courierOrders().filter((order) => order.status === "Доставлен");
    const latestPayout = payout.requests[0] || null;
    const payoutDisabled = payout.available <= 0 || payout.pending.length > 0;
    return `
      <div class="courier-section-head"><h2>Доход и статистика</h2><p class="muted">Начисления считаются по завершённым доставкам.</p></div>
      <div class="courier-income-hero"><small>Заработано всего</small><strong>${Format.money(stats.earnings)}</strong><span>${stats.delivered} завершенных доставок</span></div>
      <div class="courier-stat-grid">
        <article><span>${Ui.icon("calendar")}</span><strong>${Format.money(stats.todayEarnings)}</strong><small>сегодня</small></article>
        <article><span>${Ui.icon("bike")}</span><strong>${stats.todayDelivered}</strong><small>доставок сегодня</small></article>
        <article><span>${Ui.icon("route")}</span><strong>${stats.distance.toFixed(1)} км</strong><small>маршрут</small></article>
        <article><span>${Ui.icon("star")}</span><strong>${this.store.courierProfile.rating.toFixed(1)}</strong><small>рейтинг</small></article>
      </div>
      <div class="phone-card payout-card courier-payout-panel">
        <span class="icon-tile">${Ui.icon("wallet")}</span>
        <small>Доступно к выплате</small>
        <strong>${Format.money(payout.available)}</strong>
        <p class="muted">Выплачено: ${Format.money(payout.paidAmount)} · В обработке: ${Format.money(payout.pendingAmount)}</p>
        ${latestPayout ? `<div class="payout-status-row"><span class="status ${Ui.statusClass(latestPayout.status)}">${Format.escape(latestPayout.status)}</span><small>${Format.escape(Format.dateTime(latestPayout.createdAt))} · ${Format.money(latestPayout.amount)}</small></div>` : ""}
        <button class="btn primary" type="button" data-courier-payout ${payoutDisabled ? "disabled" : ""}>${Ui.icon("download")} Запросить выплату</button>
      </div>
      <div class="courier-history-list">${delivered.slice(0, 6).map((order) => `<div class="courier-income-row"><span class="icon-tile">${Ui.icon("check-circle")}</span><div><strong>#${Format.escape(order.id)} · ${Format.escape(order.client)}</strong><small>${Format.escape(order.date || "")}</small></div><strong>+${Format.money(this.store.courierFee(order))}</strong></div>`).join("") || '<div class="courier-empty"><strong>Завершенных доставок пока нет</strong></div>'}</div>
    `;
  }

  notificationsWorkspace() {
    const rows = this.store.courierOrders()
      .flatMap((order) => this.historyEntries(order, 5).map((entry) => ({ order, entry })))
      .sort((a, b) => Date.parse(b.entry.createdAt || 0) - Date.parse(a.entry.createdAt || 0))
      .slice(0, 14);
    return `<div class="courier-section-head"><h2>События смены</h2><p class="muted">Новые назначения, сообщения и изменения статусов.</p></div><div class="courier-history-list">${rows.map(({ order, entry }) => {
      const active = order.status !== "Доставлен";
      return `<button class="courier-notification ${active ? "unread" : ""}" type="button" data-courier-order="${Format.escape(order.id)}"><span class="icon-tile">${Ui.icon(entry.icon || (active ? "bell" : "check-circle"))}</span><div><strong>${Format.escape(entry.title || order.status)} · #${Format.escape(order.id)}</strong><p>${Format.escape(entry.details || `${order.pharmacyName || "Аптека"} → ${order.client || "Клиент"}`)}</p><small>${Format.escape(Format.dateTime(entry.createdAt || order.updatedAt || new Date()))}</small></div></button>`;
    }).join("") || '<div class="courier-empty"><strong>Событий пока нет</strong></div>'}</div>`;
  }

  profileWorkspace() {
    const profile = this.store.courierProfile;
    return `
      <div class="courier-section-head"><h2>Профиль курьера</h2><p class="muted">Данные используются для назначений и связи с аптекой.</p></div>
      <form class="courier-profile-form desktop" data-courier-profile>
        <div class="courier-avatar">${Format.escape(profile.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase())}</div>
        <label>Имя<input name="name" value="${Format.escape(profile.name)}" required /></label>
        <label>Телефон<input name="phone" value="${Format.escape(profile.phone)}" required /></label>
        <label>Транспорт<select name="transport"><option ${profile.transport === "Электровелосипед" ? "selected" : ""}>Электровелосипед</option><option ${profile.transport === "Мотоцикл" ? "selected" : ""}>Мотоцикл</option><option ${profile.transport === "Автомобиль" ? "selected" : ""}>Автомобиль</option><option ${profile.transport === "Велосипед" ? "selected" : ""}>Велосипед</option></select></label>
        <label>Номер транспорта<input name="vehicleNumber" value="${Format.escape(profile.vehicleNumber)}" placeholder="01 A 123 BC" /></label>
        <label class="courier-online-control"><input type="checkbox" name="online" ${profile.online ? "checked" : ""} /><span>Принимать новые заказы</span></label>
        <button class="btn primary" type="submit">${Ui.icon("save")} Сохранить профиль</button>
      </form>
    `;
  }

  phoneShell(body, title = "") {
    const tabs = [
      ["deliveries", "Доставки", "package-check"],
      ["map", "Карта", "map"],
      ["income", "Доходы", "wallet"],
      ["notifications", "Уведомления", "bell"],
      ["profile", "Профиль", "user"],
    ];
    const notificationCount = this.store.courierOrders().filter((order) => order.status !== "Доставлен").length;
    return `<div class="phone"><div class="phone-status"><span>9:41</span><span>${Ui.icon("signal")} ${Ui.icon("wifi")} ${Ui.icon("battery")}</span></div><div class="phone-head"><span>${Ui.icon(title ? "arrow-left" : "menu")}</span><strong>${title || `${Ui.brand()} <span class="badge green">Courier</span>`}</strong><button class="phone-head-action bell" type="button" data-courier-tab="notifications" data-count="${notificationCount}" aria-label="Уведомления">${Ui.icon("bell")}</button></div><div class="phone-body">${body}</div><div class="phone-bottom">${tabs.map(([key, label, icon]) => `<button class="phone-nav-item ${this.activeTab === key ? "active" : ""}" type="button" data-courier-tab="${key}">${Ui.icon(icon)}<span>${label}</span></button>`).join("")}</div></div>`;
  }

  phoneList() {
    const allOrders = this.store.courierOrders();
    const orders = allOrders.filter((order) => {
      if (this.filter === "active") return order.status !== "Доставлен";
      if (this.filter === "way") return order.status === "В пути";
      if (this.filter === "done") return order.status === "Доставлен";
      return true;
    });
    const selectedId = this.store.currentCourierOrder()?.id;
    const cards = orders.slice(0, 6).map((order) => `<button class="delivery-card courier-delivery-card ${order.id === selectedId ? "active" : ""}" type="button" data-courier-order="${Format.escape(order.id)}"><div class="delivery-top"><strong>#${Format.escape(order.id)}</strong><span>${Format.escape(order.time || "")}</span><span class="status ${Ui.statusClass(order.status)}">${Format.escape(order.status)}</span></div><strong>${Format.escape(order.client)}</strong><p class="muted">${Format.escape(order.address || order.district || "Адрес не указан")}</p><div class="delivery-meta"><span>${Ui.icon("banknote")} ${Format.money(order.amount)}</span><span>${Ui.icon("clock")} ${Number(order.duration) || 0} мин</span></div><small>${Ui.icon("bike")} ${Format.escape(order.courierName || "Курьер не указан")}</small></button>`).join("");
    const active = allOrders.filter((order) => order.status !== "Доставлен").length;
    const onWay = allOrders.filter((order) => order.status === "В пути").length;
    const done = allOrders.filter((order) => order.status === "Доставлен").length;
    const filterButtons = [["all", `Все ${allOrders.length}`], ["active", `Активные ${active}`], ["way", `В пути ${onWay}`], ["done", `Готово ${done}`]];
    return this.phoneShell(`<h2>Мои доставки</h2><div class="phone-tabs courier-filter-tabs">${filterButtons.map(([key, label]) => `<button class="${this.filter === key ? "active" : ""}" type="button" data-courier-filter="${key}">${label}</button>`).join("")}</div>${cards || '<div class="phone-card"><strong>Доставок в этом разделе нет</strong><p class="muted">Новые задания появятся после передачи заказа аптекой.</p></div>'}<button class="btn ghost" type="button" data-courier-refresh style="width:100%;">${Ui.icon("refresh-cw")} Обновить список</button>`);
  }

  phoneDetails() {
    const order = this.store.currentCourierOrder();
    if (!order) {
      return this.phoneShell('<div class="phone-card"><h3>Нет активного заказа</h3><p class="muted">После передачи заказа курьеру здесь появятся точки забора и доставки.</p></div>', "Детали заказа");
    }
    const pharmacyLatitude = Number.isFinite(Number(order.pharmacyLatitude)) ? Number(order.pharmacyLatitude) : 41.3111;
    const pharmacyLongitude = Number.isFinite(Number(order.pharmacyLongitude)) ? Number(order.pharmacyLongitude) : 69.2797;
    const clientLatitude = Number.isFinite(Number(order.clientLatitude)) ? Number(order.clientLatitude) : 41.3111;
    const clientLongitude = Number.isFinite(Number(order.clientLongitude)) ? Number(order.clientLongitude) : 69.2797;
    const routeUrl = this.store.googleRouteUrl(
      { latitude: pharmacyLatitude, longitude: pharmacyLongitude },
      { latitude: clientLatitude, longitude: clientLongitude },
    );
    const items = (order.items || []).map((item) => `<div class="mini-product" style="grid-template-columns:42px 1fr auto;">${Ui.packshot(item, "small")}<span>${Format.escape(item.name)}</span><span>${Number(item.quantity) || 1} уп.</span></div>`).join("");
    const contactValue = String(order.phone || "").trim();
    const contactUrl = contactValue.includes("@") ? `mailto:${contactValue}` : `tel:${contactValue}`;
    const contactLabel = contactValue.includes("@") ? "Написать клиенту" : "Позвонить клиенту";
    const pickupAction = order.status === "Передан курьеру"
      ? `<button class="btn primary" type="button" data-courier-pickup="${Format.escape(order.id)}" style="width:100%;">${Ui.icon("package-check")} Забрал заказ</button>`
      : order.status === "В пути"
        ? `<div class="courier-progress-note">${Ui.icon("bike")} <strong>Заказ в пути к клиенту</strong></div>`
        : `<div class="courier-progress-note delivered">${Ui.icon("check-circle")} <strong>Заказ доставлен</strong></div>`;
    const body = `<div class="phone-card courier-order-summary"><div><span class="badge ${Ui.statusClass(order.status)}">${Format.escape(order.status)}</span><strong>${Format.escape(order.courierName || "Курьер DoriGo")}</strong></div><small>Заказ #${Format.escape(order.id)}</small></div><div class="phone-card"><span class="badge green">Аптека (забор заказа)</span><h3>${Format.escape(order.pharmacyName || "Аптека")}</h3><p class="muted">${Format.escape(order.pharmacyAddress || "Адрес не указан")}</p><small class="coordinate-label">${pharmacyLatitude.toFixed(5)}, ${pharmacyLongitude.toFixed(5)}</small></div><div class="phone-card"><span class="badge blue">Адрес доставки (клиент)</span><h3>${Format.escape(order.client)}</h3><p class="muted">${Format.escape(order.address || "Адрес не указан")}</p><small class="coordinate-label">${clientLatitude.toFixed(5)}, ${clientLongitude.toFixed(5)}</small><div class="phone-map">${Ui.mapSurface({ latitude: clientLatitude, longitude: clientLongitude, zoom: 15, className: "phone-map-surface", label: "Точка доставки клиента", markers: [{ latitude: clientLatitude, longitude: clientLongitude, type: "client", icon: "map-pin", label: order.address || order.client, active: true }] })}</div></div>${this.phoneHistory(order)}<div class="phone-card"><h3>Состав заказа</h3>${items}<strong>К оплате клиентом <span style="float:right;">${Format.money(order.amount)}</span></strong></div>${pickupAction}<a class="btn ghost" style="width:100%;" href="${Format.escape(routeUrl)}" target="_blank" rel="noopener">${Ui.icon("navigation")} Маршрут аптека → клиент</a>${contactValue ? `<a class="btn ghost" style="width:100%;" href="${Format.escape(contactUrl)}">${Ui.icon(contactValue.includes("@") ? "mail" : "phone")} ${contactLabel}</a>` : ""}`;
    return this.phoneShell(body, `Заказ #${Format.escape(order.id)}`);
  }

  phoneConfirm() {
    const order = this.store.currentCourierOrder();
    if (!order) return this.phoneShell('<div class="phone-card"><h3>Нет заказа для подтверждения</h3></div>', "Подтверждение доставки");
    const canDeliver = order.status === "В пути";
    const photo = order.deliveryPhotoData
      ? `<div class="photo-confirm has-photo"><img src="${Format.escape(order.deliveryPhotoData)}" alt="Фото вручения заказа" /></div><p class="photo-meta">${Ui.icon("check-circle")} Фото сохранено ${order.deliveryPhotoAt ? new Date(order.deliveryPhotoAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : ""}</p>`
      : `<div class="photo-confirm empty">${Ui.icon("camera")}<span>Фото ещё не добавлено</span></div>`;
    const body = `<div class="phone-card"><div class="delivery-top"><h3>Заказ #${Format.escape(order.id)}</h3><span class="status ${Ui.statusClass(order.status)}">${Format.escape(order.status)}</span></div><p>${Format.escape(order.client)}</p><strong style="color:var(--green);">${Format.money(order.amount)}</strong></div><div class="phone-card"><h3>${Ui.icon("circle-check")} Код подтверждения</h3><p class="muted">Попросите клиента назвать код из 4 цифр</p><div class="code-boxes courier-code"><input inputmode="numeric" maxlength="1" aria-label="Первая цифра" /><input inputmode="numeric" maxlength="1" aria-label="Вторая цифра" /><input inputmode="numeric" maxlength="1" aria-label="Третья цифра" /><input inputmode="numeric" maxlength="1" aria-label="Четвертая цифра" /><span>${Ui.icon("check")}</span></div></div><div class="phone-card"><h3>${Ui.icon("camera")} Фото подтверждение</h3><p class="muted">Сделайте фото вручения заказа клиенту</p>${photo}<input class="visually-hidden-file" id="courier-photo-${Format.escape(order.id)}" data-courier-photo="${Format.escape(order.id)}" type="file" accept="image/*" capture="environment" /><label class="btn ghost courier-photo-button" for="courier-photo-${Format.escape(order.id)}">${Ui.icon("camera")} ${order.deliveryPhotoData ? "Заменить фото" : "Добавить фото"}</label></div><div class="phone-card"><h3>Примечание</h3><textarea data-courier-note placeholder="Напишите примечание...">${Format.escape(order.courierNote || "")}</textarea></div><button class="btn primary" type="button" data-courier-deliver="${Format.escape(order.id)}" style="width:100%;" ${canDeliver ? "" : "disabled"}>${Ui.icon("check-circle")} ${order.status === "Доставлен" ? "Уже доставлен" : canDeliver ? "Доставил" : "Сначала заберите заказ"}</button>`;
    return this.phoneShell(body, "Подтверждение доставки");
  }

  phoneMap() {
    const order = this.store.currentCourierOrder();
    if (!order) return this.phoneShell('<div class="phone-card"><h3>Маршрут пока не назначен</h3><p class="muted">Выберите активную доставку.</p></div>', "Карта");
    const pharmacy = {
      latitude: Number(order.pharmacyLatitude) || 41.3111,
      longitude: Number(order.pharmacyLongitude) || 69.2797,
    };
    const client = {
      latitude: Number(order.clientLatitude) || 41.3111,
      longitude: Number(order.clientLongitude) || 69.2797,
    };
    const route = this.store.googleRouteUrl(pharmacy, client);
    const center = {
      latitude: (Number(pharmacy.latitude) + Number(client.latitude)) / 2,
      longitude: (Number(pharmacy.longitude) + Number(client.longitude)) / 2,
    };
    return this.phoneShell(`<div class="phone-card courier-map-summary"><span class="status ${Ui.statusClass(order.status)}">${Format.escape(order.status)}</span><h2>Маршрут #${Format.escape(order.id)}</h2><p>${Format.escape(order.pharmacyName || "Аптека")} → ${Format.escape(order.client)}</p><div class="phone-map large">${Ui.mapSurface({ latitude: center.latitude, longitude: center.longitude, zoom: 12, className: "phone-map-surface route", label: "Маршрут курьера от аптеки до клиента", route: true, markers: [{ latitude: pharmacy.latitude, longitude: pharmacy.longitude, type: "pharmacy", icon: "hospital", label: order.pharmacyName || "Аптека", active: true }, { latitude: client.latitude, longitude: client.longitude, type: "client", icon: "map-pin", label: order.address || order.client }] })}</div></div><div class="route-points"><article><span class="route-point pharmacy">${Ui.icon("hospital")}</span><div><small>Забрать</small><strong>${Format.escape(order.pharmacyAddress || "Адрес аптеки")}</strong></div></article><article><span class="route-point client">${Ui.icon("map-pin")}</span><div><small>Доставить</small><strong>${Format.escape(order.address || "Адрес клиента")}</strong></div></article></div><div class="courier-route-metrics"><span><strong>${Number(order.distance || 0).toFixed(1)} км</strong><small>расстояние</small></span><span><strong>${Number(order.duration) || 0} мин</strong><small>в пути</small></span></div><a class="btn primary" href="${Format.escape(route)}" target="_blank" rel="noopener" style="width:100%;">${Ui.icon("navigation")} Открыть навигатор</a>`, "Карта");
  }

  phoneQueue() {
    const orders = this.store.courierOrders().filter((order) => order.status !== "Доставлен");
    const rows = orders.map((order, index) => `<button class="courier-queue-row ${order.id === this.store.selectedCourierOrderId ? "active" : ""}" type="button" data-courier-order="${Format.escape(order.id)}"><span>${index + 1}</span><div><strong>#${Format.escape(order.id)} · ${Format.escape(order.client)}</strong><small>${Format.escape(order.address || "Адрес не указан")}</small></div><em>${Number(order.duration) || 0} мин</em></button>`).join("");
    return this.phoneShell(`<div class="phone-section-title"><div><h2>Очередь доставок</h2><p class="muted">Активных заданий: ${orders.length}</p></div><span class="icon-tile">${Ui.icon("route")}</span></div>${rows || '<div class="phone-card"><strong>Очередь пуста</strong><p class="muted">Все назначенные доставки завершены.</p></div>'}`, "Маршруты");
  }

  phoneIncome() {
    const stats = this.store.courierStats();
    const delivered = this.store.courierOrders().filter((order) => order.status === "Доставлен").slice(0, 7);
    const maxFee = Math.max(...delivered.map((order) => this.store.courierFee(order)), 1);
    const bars = delivered.length
      ? delivered.slice().reverse().map((order) => `<span style="height:${Math.max(18, Math.round(this.store.courierFee(order) / maxFee * 100))}%;" title="${Format.money(this.store.courierFee(order))}"></span>`).join("")
      : `<span style="height:18%;"></span><span style="height:18%;"></span><span style="height:18%;"></span>`;
    return this.phoneShell(`<div class="courier-income-hero"><small>Заработано всего</small><strong>${Format.money(stats.earnings)}</strong><span>${stats.delivered} завершенных доставок</span></div><div class="courier-stat-grid"><article><span>${Ui.icon("calendar")}</span><strong>${Format.money(stats.todayEarnings)}</strong><small>сегодня</small></article><article><span>${Ui.icon("bike")}</span><strong>${stats.todayDelivered}</strong><small>доставок сегодня</small></article><article><span>${Ui.icon("route")}</span><strong>${stats.distance.toFixed(1)} км</strong><small>общий путь</small></article><article><span>${Ui.icon("star")}</span><strong>${this.store.courierProfile.rating.toFixed(1)}</strong><small>рейтинг</small></article></div><div class="phone-card"><div class="delivery-top"><h3>Последние доставки</h3><span class="muted">${delivered.length}</span></div><div class="courier-income-bars">${bars}</div></div>`, "Доходы");
  }

  phoneIncomeHistory() {
    const delivered = this.store.courierOrders().filter((order) => order.status === "Доставлен");
    const rows = delivered.map((order) => `<div class="courier-income-row"><span class="icon-tile">${Ui.icon("check-circle")}</span><div><strong>Заказ #${Format.escape(order.id)}</strong><small>${Format.escape(order.client)} · ${Format.escape(order.date || "")}</small></div><strong>+${Format.money(this.store.courierFee(order))}</strong></div>`).join("");
    return this.phoneShell(`<h2>Начисления</h2>${rows || '<div class="phone-card"><strong>Начислений пока нет</strong><p class="muted">Доход появится после первой завершенной доставки.</p></div>'}`, "История");
  }

  phonePayouts() {
    const payout = this.store.courierPayoutSummary();
    const latestPayout = payout.requests[0] || null;
    const payoutDisabled = payout.available <= 0 || payout.pending.length > 0;
    return this.phoneShell(`<div class="phone-card payout-card"><span class="icon-tile">${Ui.icon("wallet")}</span><small>Доступно к выплате</small><strong>${Format.money(payout.available)}</strong><p class="muted">Выплачено: ${Format.money(payout.paidAmount)} · В обработке: ${Format.money(payout.pendingAmount)}</p>${latestPayout ? `<div class="payout-status-row"><span class="status ${Ui.statusClass(latestPayout.status)}">${Format.escape(latestPayout.status)}</span><small>${Format.escape(Format.dateTime(latestPayout.createdAt))} · ${Format.money(latestPayout.amount)}</small></div>` : ""}<button class="btn primary" type="button" data-courier-payout ${payoutDisabled ? "disabled" : ""}>${Ui.icon("download")} Запросить выплату</button></div><div class="phone-card"><h3>Как считается доход</h3><p class="muted">Стоимость зависит от расстояния маршрута. Минимальное начисление за завершенную доставку — 12 000 сум.</p></div>`, "Выплаты");
  }

  phoneNotifications() {
    const orders = this.store.courierOrders();
    const rows = orders.slice(0, 8).map((order) => {
      const active = order.status !== "Доставлен";
      return `<button class="courier-notification ${active ? "unread" : ""}" type="button" data-courier-order="${Format.escape(order.id)}"><span class="icon-tile">${Ui.icon(active ? "bell" : "check-circle")}</span><div><strong>${order.status === "Передан курьеру" ? "Новая доставка назначена" : order.status === "В пути" ? "Заказ ожидает вручения" : "Доставка завершена"}</strong><p>Заказ #${Format.escape(order.id)} · ${Format.escape(order.client)}</p><small>${Format.escape(order.time || order.date || "")}</small></div></button>`;
    }).join("");
    return this.phoneShell(`<div class="phone-section-title"><div><h2>Уведомления</h2><p class="muted">${orders.filter((order) => order.status !== "Доставлен").length} требуют внимания</p></div><span class="icon-tile">${Ui.icon("bell")}</span></div>${rows || '<div class="phone-card"><strong>Уведомлений нет</strong><p class="muted">Здесь появятся новые назначения и изменения заказов.</p></div>'}`, "Уведомления");
  }

  phoneSupport() {
    return this.phoneShell(`<div class="phone-card support-contact"><span class="icon-tile">${Ui.icon("headphones")}</span><h2>Поддержка DoriGo</h2><p class="muted">Сообщите номер заказа, если возникла проблема с аптекой, маршрутом или клиентом.</p><a class="btn primary" href="tel:+998712070707">${Ui.icon("phone")} +998 71 207-07-07</a><a class="btn ghost" href="mailto:support@dorigo.uz">${Ui.icon("mail")} Написать в поддержку</a></div><div class="phone-card"><h3>Частые вопросы</h3><p>Что делать, если клиент не отвечает?</p><p>Как изменить адрес доставки?</p><p>Когда начисляется оплата?</p></div>`, "Поддержка");
  }

  phoneProfile() {
    const profile = this.store.courierProfile;
    return this.phoneShell(`<form class="courier-profile-form" data-courier-profile><div class="courier-avatar">${Format.escape(profile.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase())}</div><h2>${Format.escape(profile.name)}</h2><span class="status ${profile.online ? "ok" : "muted"}">${profile.online ? "Онлайн" : "Офлайн"}</span><label>Имя<input name="name" value="${Format.escape(profile.name)}" required /></label><label>Телефон<input name="phone" value="${Format.escape(profile.phone)}" required /></label><label>Транспорт<select name="transport"><option ${profile.transport === "Электровелосипед" ? "selected" : ""}>Электровелосипед</option><option ${profile.transport === "Мотоцикл" ? "selected" : ""}>Мотоцикл</option><option ${profile.transport === "Автомобиль" ? "selected" : ""}>Автомобиль</option><option ${profile.transport === "Велосипед" ? "selected" : ""}>Велосипед</option></select></label><label>Номер транспорта<input name="vehicleNumber" value="${Format.escape(profile.vehicleNumber)}" placeholder="01 A 123 BC" /></label><label class="courier-online-control"><input type="checkbox" name="online" ${profile.online ? "checked" : ""} /><span>Принимать новые заказы</span></label><button class="btn primary" type="submit">${Ui.icon("save")} Сохранить профиль</button></form>`, "Профиль");
  }

  phoneVehicle() {
    const profile = this.store.courierProfile;
    const stats = this.store.courierStats();
    return this.phoneShell(`<div class="phone-card vehicle-card"><span class="icon-tile">${Ui.icon(profile.transport === "Автомобиль" ? "car" : "bike")}</span><h2>${Format.escape(profile.transport)}</h2><strong>${Format.escape(profile.vehicleNumber || "Номер не указан")}</strong><span class="status ${profile.online ? "ok" : "muted"}">${profile.online ? "Готов к заказам" : "Смена завершена"}</span></div><div class="courier-stat-grid"><article><strong>${stats.delivered}</strong><small>доставлено</small></article><article><strong>${stats.active}</strong><small>активно</small></article><article><strong>${stats.distance.toFixed(1)} км</strong><small>пройдено</small></article><article><strong>${profile.rating.toFixed(1)}</strong><small>рейтинг</small></article></div>`, "Транспорт");
  }
}

class DoriGoApp {
  constructor(root) {
    this.root = root;
    this.accounts = new AccountService();
    this.store = new DoriGoStore(this.accounts);
    this.publicViews = new PublicViews(this.store);
    this.dashboardViews = new DashboardViews(this.store);
    this.courierView = new CourierView(this.store);
    this.searchState = this.defaultSearchState();
    this.homeCategory = "all";
    this.authMode = null;
    this.authType = "patient";
    this.authReturnRoute = null;
    this.settingsTab = "profile";
    this.productTab = "description";
    this.productModalOpen = false;
    this.productDraft = {};
    this.catalogMatches = [];
    this.importSummary = null;
    this.store.selectedPartnerOrders = new Set();
    this.orderState = { tab: "Все", query: "", dateFrom: "", dateTo: "", type: "all", sort: "newest", page: 1, pageSize: 10 };
    this.inventoryState = { query: "", category: "", status: "all", expiry: "all", page: 1, pageSize: 20 };
    this.pricingState = { query: "", category: "", promotion: "all", page: 1, pageSize: 20 };
    this.analyticsPeriod = "7";
    this.adminCatalogState = { query: "", selectedId: "" };
    this.adminCatalogImages = [];
    this.adminCatalogImagesProductId = "";
    this.locationPicker = null;
    this.orderScanId = null;
    this.toast = "";
    this.toastTimer = null;
    this.mapResizeTimer = null;
    this.lastRenderedRoute = null;
  }

  start() {
    window.addEventListener("hashchange", () => this.render());
    window.addEventListener("resize", () => {
      window.clearTimeout(this.mapResizeTimer);
      this.mapResizeTimer = window.setTimeout(() => this.renderAllMapSurfaces(), 120);
    });
    if (!window.location.hash) {
      window.location.hash = "#home";
      return;
    }
    this.render();
  }

  currentRoute() {
    return window.location.hash.replace("#", "") || "home";
  }

  partnerRoutes() {
    return new Set([
      "partner",
      "partner-orders",
      "partner-order",
      "inventory",
      "partner-pricing",
      "partner-analytics",
      "partner-support",
      "partner-settings",
      "partner-categories",
    ]);
  }

  defaultSearchState() {
    return {
      query: "",
      sort: "best",
      view: "grid",
      categories: new Set(),
      forms: new Set(),
      dosages: new Set(),
      minPrice: "",
      maxPrice: "",
      inStock: false,
      deliveryToday: false,
      otcOnly: false,
      page: 1,
    };
  }

  render() {
    const route = this.currentRoute();
    const routeChanged = this.lastRenderedRoute !== route;
    const previousScrollY = window.scrollY;
    const user = this.accounts.currentUser();
    if (this.partnerRoutes().has(route) && user?.type === "pharmacy") {
      this.store.syncActivePharmacyData();
    }
    if (!this.store.products.length && this.store.catalogProducts.length) {
      this.store.refreshMarketplaceProducts();
    }
    const pages = {
      home: () => this.publicViews.home(this.homeCategory),
      search: () => this.publicViews.search(this.searchState),
      product: () => this.publicViews.product(this.productTab),
      order: () => this.publicViews.order(),
      account: () => this.publicViews.account(user),
      partner: () => this.dashboardViews.partnerDashboard(),
      "partner-orders": () => this.dashboardViews.partnerOrdersPage(this.orderState),
      "partner-order": () => this.dashboardViews.partnerOrderDetail(),
      inventory: () => this.dashboardViews.inventory(this.inventoryState),
      "partner-pricing": () => this.dashboardViews.pricing(this.pricingState),
      "partner-analytics": () => this.dashboardViews.analytics(this.analyticsPeriod),
      "partner-support": () => this.dashboardViews.support(),
      "partner-settings": () => this.dashboardViews.settings(this.settingsTab),
      "partner-categories": () => this.dashboardViews.categories(),
      admin: () => this.dashboardViews.adminDashboard(),
      "admin-catalog": () => this.dashboardViews.adminCatalog({
        ...this.adminCatalogState,
        images: this.adminCatalogImages,
        imagesProductId: this.adminCatalogImagesProductId,
      }),
      courier: () => this.courierView.render(),
    };
    const page = this.partnerRoutes().has(route) && user?.type !== "pharmacy"
      ? this.publicViews.accessGate(user, "partner", route)
      : (pages[route] || pages.home)();

    this.root.innerHTML = `
      ${page}
      <input class="visually-hidden-file" data-excel-input type="file" accept=".xlsx,.xls,.csv,.tsv" />
      <input class="visually-hidden-file" data-backup-input type="file" accept="application/json,.json" />
      ${Ui.authModal(this.authMode, this.authType)}
      ${Ui.productModal(this.productModalOpen, this.productDraft, this.catalogMatches, this.store.categories.map((category) => category.name), this.store.catalogProducts, this.store.pharmacyInventory)}
      ${Ui.importSummaryModal(this.importSummary)}
      ${Ui.orderScanModal(this.store.orders.find((order) => order.id === this.orderScanId))}
      ${Ui.locationPickerModal(
        this.locationPicker,
        this.locationPicker
          ? this.store.googleMapUrl(this.locationPicker.latitude, this.locationPicker.longitude, this.locationPicker.zoom)
          : "",
      )}
      ${Ui.toast(this.toast)}
    `;
    this.bindEvents(route);
    this.lastRenderedRoute = route;
    window.requestAnimationFrame(() => {
      this.renderAllMapSurfaces();
      window.scrollTo({ top: routeChanged ? 0 : previousScrollY, behavior: "auto" });
    });
  }

  bindEvents(route) {
    this.root.querySelectorAll("[data-auth]").forEach((button) => {
      button.addEventListener("click", () => {
        this.authMode = button.dataset.auth;
        this.authType = button.dataset.authAccountType || this.authType || "patient";
        this.authReturnRoute = button.dataset.authTarget || (route === "account" || this.partnerRoutes().has(route) ? route : null);
        this.render();
      });
    });

    this.root.querySelectorAll("[data-auth-type]").forEach((button) => {
      button.addEventListener("click", () => {
        this.authType = button.dataset.authType;
        this.render();
      });
    });

    this.root.querySelectorAll("[data-auth-logout]").forEach((button) => {
      button.addEventListener("click", () => {
        this.accounts.logout();
        if (route === "account" || this.partnerRoutes().has(route)) {
          this.toast = "Вы вышли из аккаунта";
          window.location.hash = "#home";
        } else {
          this.showToast("Вы вышли из аккаунта");
        }
      });
    });

    this.root.querySelectorAll("[data-close-auth]").forEach((node) => {
      node.addEventListener("click", (event) => {
        if (!event.target.closest("[data-close-auth]")) return;
        this.authMode = null;
        this.render();
      });
    });

    this.root.querySelectorAll(".auth-modal").forEach((modal) => {
      modal.addEventListener("click", (event) => event.stopPropagation());
    });

    this.root.querySelectorAll(".auth-form").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const mode = form.dataset.authForm;
        const data = Object.fromEntries(new FormData(form));
        const result = mode === "register"
          ? data.accountType === "pharmacy"
            ? await this.accounts.registerPharmacy({
                ...data,
                isNetwork: form.elements.isNetwork?.checked,
              })
            : await this.accounts.registerPatient(data)
          : await this.accounts.login(data.contact, data.password, data.accountType || "patient");
        if (!result.ok) {
          this.showToast(result.message);
          return;
        }
        this.authMode = null;
        const returnRoute = this.authReturnRoute;
        this.authReturnRoute = null;
        this.authType = "patient";
        this.showToast(mode === "register" ? "Аккаунт создан. Данные сохранены в системе." : `Добро пожаловать, ${result.user.name}!`);
        if (result.user.type === "pharmacy") {
          this.store.syncActivePharmacyData();
          window.location.hash = `#${returnRoute && this.partnerRoutes().has(returnRoute) ? returnRoute : "partner"}`;
        } else {
          this.store.customerLocation = this.store.loadCustomerLocation();
          window.location.hash = `#${returnRoute === "order" ? "order" : "account"}`;
        }
      });
    });

    this.bindAccountEvents();
    this.bindMarketplaceEvents();
    this.bindHomeCategoryEvents();
    this.bindProductCarouselEvents();
    this.bindInventoryEvents();
    this.bindPartnerDataEvents();
    this.bindDashboardSearch(route);
    this.bindDashboardNotifications(route);
    this.bindSettingsEvents();
    this.bindAdminCatalogEvents();
    this.bindAdminDashboardEvents();
    this.bindLocationPickerEvents();
    this.bindCourierEvents();

    this.root.querySelectorAll("[data-toast]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.showToast(button.dataset.toast);
      });
    });

    this.bindSearchShortcuts();
    if (route === "search" || route === "product") this.bindCatalogEvents();
  }

  bindDashboardSearch(route) {
    const input = this.root.querySelector("[data-dashboard-search]");
    if (!input) return;
    const submit = () => {
      const query = input.value.trim();
      if (!query) {
        this.showToast("Введите номер заказа, клиента или товар для поиска.");
        return;
      }
      this.runDashboardSearch(query, route);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      submit();
    });
    input.addEventListener("search", submit);
  }

  runDashboardSearch(query, route) {
    const normalized = this.store.normalizeLookup(query).replace(/^#/, "");
    const orderMatch = this.store.orders.find((order) => {
      const orderText = this.store.normalizeLookup([
        order.id,
        order.client,
        order.phone,
        order.district,
        order.address,
        order.productName,
        ...(Array.isArray(order.items) ? order.items.map((item) => item.name) : []),
      ].join(" "));
      return orderText.includes(normalized);
    });
    const exactOrder = this.store.orders.find((order) => this.store.normalizeLookup(order.id).replace(/^#/, "") === normalized);
    const productMatch = this.store.pharmacyInventory.find((product) => {
      const productText = this.store.normalizeLookup([
        product.name,
        product.subtitle,
        product.mnn,
        product.ingredient,
        product.barcode,
        product.category,
        product.manufacturer,
      ].join(" "));
      return productText.includes(normalized);
    });
    const categoryMatch = this.store.categories.find((category) => this.store.normalizeLookup(category.name).includes(normalized));

    if (exactOrder) {
      this.store.selectedOrderId = exactOrder.id;
      window.location.hash = "#partner-order";
      return;
    }

    if (route === "partner-pricing" && (productMatch || categoryMatch)) {
      this.pricingState = {
        query: categoryMatch && !productMatch ? "" : query,
        category: categoryMatch && !productMatch ? categoryMatch.name : "",
        promotion: "all",
      };
      if (this.currentRoute() === "partner-pricing") this.render();
      else window.location.hash = "#partner-pricing";
      return;
    }

    if (categoryMatch) {
      this.inventoryState = { query: "", category: categoryMatch.name, status: "all", expiry: "all" };
      window.location.hash = "#inventory";
      if (this.currentRoute() === "inventory") this.render();
      return;
    }

    if (productMatch || route === "inventory" || route === "partner" || route === "partner-categories") {
      this.inventoryState = { query, category: "", status: "all", expiry: "all" };
      window.location.hash = "#inventory";
      if (this.currentRoute() === "inventory") this.render();
      return;
    }

    if (route === "partner-orders" || route === "partner-order" || orderMatch) {
      this.orderState = { tab: "Все", query, dateFrom: "", dateTo: "", type: "all", sort: "newest", page: 1, pageSize: 10 };
      window.location.hash = "#partner-orders";
      if (this.currentRoute() === "partner-orders") this.render();
      return;
    }

    this.orderState = { tab: "Все", query, dateFrom: "", dateTo: "", type: "all", sort: "newest", page: 1, pageSize: 10 };
    window.location.hash = "#partner-orders";
    if (this.currentRoute() === "partner-orders") this.render();
  }

  bindDashboardNotifications(route) {
    const bell = this.root.querySelector("[data-dashboard-bell]");
    if (!bell) return;
    const openTasks = () => {
      if (route === "admin" || route === "admin-catalog") {
        window.location.hash = "#admin-catalog";
        return;
      }
      const orders = this.store.orderStats();
      const inventory = this.store.inventoryStats();
      if (orders.new > 0) {
        this.orderState = { tab: "Новые", query: "", dateFrom: "", dateTo: "", type: "all", sort: "newest", page: 1, pageSize: 10 };
        window.location.hash = "#partner-orders";
      } else if (orders.confirmed > 0) {
        this.orderState = { tab: "Подтвердить", query: "", dateFrom: "", dateTo: "", type: "all", sort: "newest", page: 1, pageSize: 10 };
        window.location.hash = "#partner-orders";
      } else if (orders.assembly > 0) {
        this.orderState = { tab: "Сборка", query: "", dateFrom: "", dateTo: "", type: "all", sort: "newest", page: 1, pageSize: 10 };
        window.location.hash = "#partner-orders";
      } else if (inventory.lowStock > 0) {
        this.inventoryState = { query: "", category: "", status: "low", expiry: "all" };
        window.location.hash = "#inventory";
      } else if (inventory.outOfStock > 0) {
        this.inventoryState = { query: "", category: "", status: "out", expiry: "all" };
        window.location.hash = "#inventory";
      } else {
        this.showToast("Критичных задач сейчас нет.");
      }
      if (["partner-orders", "inventory"].includes(this.currentRoute())) this.render();
    };
    bell.addEventListener("click", openTasks);
    bell.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openTasks();
    });
  }

  bindAccountEvents() {
    this.root.querySelector("[data-patient-profile]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const result = this.accounts.updateCurrentUser(data);
      if (result.ok && this.store.customerLocation.source !== "default") {
        this.store.setCustomerLocation({
          ...this.store.customerLocation,
          address: data.address,
          label: data.address || this.store.customerLocation.label,
          source: "account",
        });
      }
      this.showToast(result.message);
    });

    this.root.querySelector("[data-password-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = Object.fromEntries(new FormData(form));
      const result = await this.accounts.changePassword(data.currentPassword, data.newPassword);
      if (result.ok) form.reset();
      this.showToast(result.message);
    });
  }

  bindMarketplaceEvents() {
    this.root.querySelectorAll("[data-favorite-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const result = this.store.toggleFavorite(button.dataset.favoriteToggle);
        if (!result.ok) {
          this.authMode = "login";
          this.authType = "patient";
          this.authReturnRoute = this.currentRoute();
        }
        this.showToast(result.message);
      });
    });

    this.root.querySelectorAll("[data-product-select]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        this.store.selectedProductId = link.dataset.productSelect;
        this.store.selectedOfferId = null;
        this.store.highlightedOfferId = "";
        this.store.checkoutMode = false;
        this.productTab = "description";
        if (this.currentRoute() === "product") this.render();
        else window.location.hash = "#product";
      });
    });

    this.root.querySelectorAll("[data-offer-sort]").forEach((button) => {
      button.addEventListener("click", () => {
        this.store.offerSort = button.dataset.offerSort;
        this.render();
      });
    });

    this.root.querySelectorAll("[data-offer-select]").forEach((button) => {
      button.addEventListener("click", () => {
        const offer = this.store.marketplaceOffers(this.store.selectedProductId)
          .find((item) => item.id === button.dataset.offerSelect);
        if (!offer || offer.available < 1) {
          this.showToast("У выбранной аптеки закончился остаток. Выберите другое предложение.");
          this.render();
          return;
        }
        this.store.selectedOfferId = offer.id;
        this.store.checkoutQuantity = 1;
        this.store.checkoutMode = true;
        const user = this.accounts.currentUser();
        if (!user) {
          this.authMode = "login";
          this.authType = "patient";
          this.authReturnRoute = "order";
          this.render();
          return;
        }
        if (user.type !== "patient") {
          this.showToast("Для оформления заказа войдите как пациент.");
          return;
        }
        window.location.hash = "#order";
      });
    });

    this.root.querySelectorAll("[data-customer-location]").forEach((button) => {
      button.addEventListener("click", () => {
        const user = this.accounts.currentUser();
        const location = this.store.customerLocation;
        this.openLocationPicker({
          mode: "patient",
          latitude: location.latitude,
          longitude: location.longitude,
          address: user?.type === "patient" ? user.address : location.address || "",
          zoom: 15,
        });
      });
    });

    this.root.querySelector("[data-checkout-back]")?.addEventListener("click", () => {
      this.store.checkoutMode = false;
      window.location.hash = "#product";
    });

    const checkoutType = this.root.querySelector("[data-checkout-type]");
    const checkoutQuantity = this.root.querySelector("[data-checkout-quantity]");
    const clampCheckoutQuantity = () => {
      if (!checkoutQuantity) return 1;
      const selected = this.store.selectedOffer();
      const max = Math.max(1, Number(selected?.available) || 1);
      const quantity = Math.min(max, Math.max(1, Math.floor(Number(checkoutQuantity.value) || 1)));
      checkoutQuantity.value = String(quantity);
      return quantity;
    };
    const syncCheckoutType = () => {
      const selected = this.store.selectedOffer();
      if (!selected || !checkoutType) return;
      const quantity = clampCheckoutQuantity();
      this.store.checkoutQuantity = quantity;
      const delivery = checkoutType.value === "Доставка";
      const fee = delivery ? selected.deliveryFee : 0;
      const productsTotal = selected.price * quantity;
      const total = productsTotal + fee;
      const addressField = this.root.querySelector("[data-checkout-address]");
      const addressInput = addressField?.querySelector("input");
      if (addressField) addressField.style.display = delivery ? "" : "none";
      if (addressInput) addressInput.required = delivery;
      const productLabel = this.root.querySelector("[data-checkout-product-label]");
      const productsTotalValue = this.root.querySelector("[data-checkout-products-total]");
      const deliveryValue = this.root.querySelector("[data-checkout-delivery]");
      const totalValue = this.root.querySelector("[data-checkout-total]");
      const submit = this.root.querySelector("[data-checkout-submit]");
      const reserveLeft = this.root.querySelector("[data-checkout-reserve-left]");
      const modeLabel = this.root.querySelector("[data-checkout-mode-label]");
      if (productLabel) productLabel.textContent = `Товар x ${quantity}`;
      if (productsTotalValue) productsTotalValue.textContent = Format.money(productsTotal);
      if (deliveryValue) deliveryValue.textContent = fee ? Format.money(fee) : "Бесплатно";
      if (totalValue) totalValue.textContent = Format.money(total);
      if (submit) submit.innerHTML = `${Ui.icon("check-circle")} Подтвердить заказ на ${Format.money(total)}`;
      if (reserveLeft) {
        const left = Math.max(0, selected.available - quantity);
        reserveLeft.textContent = left > 0 ? `${left} уп. останется в аптеке` : "резервируем последнюю упаковку";
      }
      if (modeLabel) {
        modeLabel.textContent = delivery
          ? `доставка около ${selected.deliveryMinutes || 30} мин`
          : "самовывоз из аптеки";
      }
    };
    checkoutType?.addEventListener("change", syncCheckoutType);
    checkoutQuantity?.addEventListener("input", syncCheckoutType);
    checkoutQuantity?.addEventListener("change", syncCheckoutType);
    this.root.querySelectorAll("[data-checkout-quantity-step]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!checkoutQuantity) return;
        checkoutQuantity.value = String((Number(checkoutQuantity.value) || 1) + (Number(button.dataset.checkoutQuantityStep) || 0));
        syncCheckoutType();
      });
    });
    syncCheckoutType();

    this.root.querySelector("[data-checkout-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const result = this.store.createPatientOrder(data);
      if (!result.ok) {
        this.showToast(result.message);
        return;
      }
      this.showToast(result.order.autoConfirmed
        ? `Заказ #${result.order.id} автоматически подтвержден аптекой`
        : `Заказ #${result.order.id} отправлен в аптеку`);
    });

    this.root.querySelectorAll("[data-patient-order]").forEach((button) => {
      button.addEventListener("click", () => {
        this.store.selectedPatientOrderId = button.dataset.patientOrder;
        this.store.checkoutMode = false;
        if (this.currentRoute() === "order") this.render();
        else window.location.hash = "#order";
      });
    });

    this.root.querySelectorAll("[data-patient-notification]").forEach((button) => {
      button.addEventListener("click", () => {
        const orderId = button.dataset.orderId || "";
        this.store.accounts.markPatientNotificationRead(button.dataset.patientNotification);
        if (orderId) {
          this.store.selectedPatientOrderId = orderId;
          this.store.checkoutMode = false;
          window.location.hash = "#order";
          return;
        }
        this.render();
      });
    });

    this.root.querySelector("[data-patient-notifications-read]")?.addEventListener("click", () => {
      const result = this.store.accounts.markPatientNotificationRead();
      this.showToast(result.message);
      this.render();
    });

    this.root.querySelectorAll("[data-patient-repeat]").forEach((button) => {
      button.addEventListener("click", () => {
        const result = this.store.prepareRepeatOrder(button.dataset.patientRepeat);
        this.showToast(result.message);
        if (!result.ok) return;
        if (this.currentRoute() === "order") this.render();
        else window.location.hash = "#order";
      });
    });

    this.root.querySelector("[data-patient-review-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const result = this.store.savePatientReview(String(data.get("orderId") || ""), {
        rating: data.get("rating"),
        text: data.get("text"),
      });
      this.showToast(result.message);
      if (result.ok) this.render();
    });

    this.root.querySelectorAll("[data-order-chat-form]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const result = this.store.sendOrderMessage(String(data.get("orderId") || ""), data.get("message"));
        this.showToast(result.message);
        if (result.ok) {
          form.reset();
          this.render();
        }
      });
    });

  }

  bindHomeCategoryEvents() {
    this.root.querySelectorAll("[data-home-category]").forEach((button) => {
      button.addEventListener("click", () => {
        const category = button.dataset.homeCategory || "all";
        this.homeCategory = this.homeCategory === category ? "all" : category;
        this.render();
      });
    });
  }

  bindProductCarouselEvents() {
    this.root.querySelectorAll("[data-product-carousel]").forEach((carousel) => {
      const track = carousel.querySelector("[data-product-carousel-track]");
      const previous = carousel.querySelector("[data-product-carousel-prev]");
      const next = carousel.querySelector("[data-product-carousel-next]");
      const status = carousel.querySelector("[data-product-carousel-status]");
      if (!track || !previous || !next) return;

      const cards = [...track.querySelectorAll(".carousel-product-card")];
      const metrics = () => {
        const card = cards[0];
        const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
        const cardWidth = card?.getBoundingClientRect().width || track.clientWidth;
        const step = cardWidth + gap;
        const visible = Math.max(1, Math.round((track.clientWidth + gap) / step));
        return { step, visible };
      };
      const update = () => {
        const { step, visible } = metrics();
        const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
        const start = cards.length ? Math.min(cards.length, Math.round(track.scrollLeft / step) + 1) : 0;
        const end = Math.min(cards.length, start + visible - 1);
        previous.disabled = track.scrollLeft <= 2;
        next.disabled = track.scrollLeft >= maxScroll - 2;
        if (status) status.textContent = cards.length ? `${start}–${end} из ${cards.length}` : "";
      };
      const move = (direction) => {
        const { step, visible } = metrics();
        track.scrollBy({ left: direction * step * visible, behavior: "smooth" });
      };

      previous.addEventListener("click", () => move(-1));
      next.addEventListener("click", () => move(1));
      track.addEventListener("scroll", () => window.requestAnimationFrame(update), { passive: true });
      track.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        move(event.key === "ArrowRight" ? 1 : -1);
      });
      update();
    });
  }

  bindPartnerDataEvents() {
    this.root.querySelectorAll("[data-order-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        this.orderState.tab = button.dataset.orderTab;
        this.orderState.page = 1;
        this.render();
      });
    });

    const orderSearch = this.root.querySelector("[data-order-search]");
    const applyOrderSearch = () => {
      this.orderState.query = orderSearch?.value.trim() || "";
      this.orderState.page = 1;
      this.render();
    };
    let orderSearchTimer = null;
    orderSearch?.addEventListener("input", () => {
      window.clearTimeout(orderSearchTimer);
      orderSearchTimer = window.setTimeout(applyOrderSearch, 250);
    });
    orderSearch?.addEventListener("change", applyOrderSearch);
    orderSearch?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        window.clearTimeout(orderSearchTimer);
        applyOrderSearch();
      }
    });
    const updateOrderFilter = (patch) => {
      this.orderState = { ...this.orderState, ...patch, page: 1 };
      this.render();
    };
    this.root.querySelector("[data-order-date-from]")?.addEventListener("change", (event) => {
      updateOrderFilter({ dateFrom: event.currentTarget.value });
    });
    this.root.querySelector("[data-order-date-to]")?.addEventListener("change", (event) => {
      updateOrderFilter({ dateTo: event.currentTarget.value });
    });
    this.root.querySelector("[data-order-type]")?.addEventListener("change", (event) => {
      updateOrderFilter({ type: event.currentTarget.value || "all" });
    });
    this.root.querySelector("[data-order-sort]")?.addEventListener("change", (event) => {
      updateOrderFilter({ sort: event.currentTarget.value || "newest" });
    });
    this.root.querySelectorAll("[data-order-page]").forEach((button) => {
      button.addEventListener("click", () => {
        this.orderState.page = Math.max(1, Number(button.dataset.orderPage) || 1);
        this.render();
      });
    });
    this.root.querySelector("[data-order-page-size]")?.addEventListener("change", (event) => {
      this.orderState.pageSize = Math.max(5, Number(event.currentTarget.value) || 10);
      this.orderState.page = 1;
      this.render();
    });
    this.root.querySelectorAll("[data-order-reset]").forEach((button) => {
      button.addEventListener("click", () => {
        this.orderState = { tab: "Все", query: "", dateFrom: "", dateTo: "", type: "all", sort: "newest", page: 1, pageSize: 10 };
        this.render();
      });
    });
    this.root.querySelector("[data-orders-export]")?.addEventListener("click", () => {
      const rows = this.store.filterOrders({ ...this.orderState, page: 1 });
      const header = ["ID", "Дата", "Время", "Клиент", "Телефон", "Тип", "Статус", "Оплата", "Товары", "Сумма", "Адрес"];
      const csvRows = rows.map((order) => [
        order.id,
        order.date,
        order.time,
        order.client,
        order.phone,
        order.type,
        order.status,
        order.payment,
        Array.isArray(order.items) && order.items.length
          ? order.items.map((item) => `${item.name} x${item.quantity || 1}`).join(", ")
          : order.productName || `${order.itemCount || 0} товара`,
        order.amount,
        order.address || order.district,
      ]);
      this.downloadCsv("dorigo-orders.csv", [header, ...csvRows]);
      this.showToast(`Экспортировано заказов: ${rows.length}`);
    });

    this.root.querySelectorAll("[data-order-select]").forEach((input) => {
      input.addEventListener("change", () => {
        if (!this.store.selectedPartnerOrders) this.store.selectedPartnerOrders = new Set();
        if (input.checked) {
          this.store.selectedPartnerOrders.add(input.dataset.orderSelect);
        } else {
          this.store.selectedPartnerOrders.delete(input.dataset.orderSelect);
        }
        this.render();
      });
    });

    this.root.querySelector("[data-order-select-page]")?.addEventListener("change", (event) => {
      if (!this.store.selectedPartnerOrders) this.store.selectedPartnerOrders = new Set();
      this.root.querySelectorAll("[data-order-select]").forEach((input) => {
        if (event.currentTarget.checked) {
          this.store.selectedPartnerOrders.add(input.dataset.orderSelect);
        } else {
          this.store.selectedPartnerOrders.delete(input.dataset.orderSelect);
        }
      });
      this.render();
    });

    this.root.querySelectorAll("[data-order-bulk]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!this.store.selectedPartnerOrders) this.store.selectedPartnerOrders = new Set();
        const action = button.dataset.orderBulk;
        const ids = [...this.store.selectedPartnerOrders];
        if (action === "clear") {
          this.store.selectedPartnerOrders.clear();
          this.render();
          return;
        }
        const result = action === "cancel"
          ? this.store.bulkCancelOrders(ids)
          : this.store.bulkAdvanceOrders(ids);
        if (result.ok) {
          this.store.selectedPartnerOrders.clear();
        }
        this.showToast(result.message);
      });
    });

    this.root.querySelector("[data-auto-confirm-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const result = this.store.saveOrderAutomation({
        autoConfirm: form.elements.autoConfirm?.checked,
        limit: data.get("limit"),
      });
      this.showToast(result.message);
      if (result.ok) this.render();
    });

    this.root.querySelectorAll("[data-order-item-collected]").forEach((input) => {
      input.addEventListener("change", () => {
        const result = this.store.setOrderItemCollected(
          input.dataset.orderItemCollected,
          Number(input.dataset.itemIndex),
          input.checked,
        );
        this.showToast(result.message);
        if (result.ok) this.render();
      });
    });

    this.root.querySelector("[data-order-items-all]")?.addEventListener("change", (event) => {
      const input = event.currentTarget;
      const result = this.store.setAllOrderItemsCollected(input.dataset.orderItemsAll, input.checked);
      this.showToast(result.message);
      if (result.ok) this.render();
    });

    this.root.querySelectorAll("[data-order-chat-focus]").forEach((button) => {
      button.addEventListener("click", () => {
        const targetId = button.dataset.orderChatFocus || "";
        const form = [...this.root.querySelectorAll("[data-order-chat-form]")]
          .find((item) => item.querySelector('input[name="orderId"]')?.value === targetId)
          || this.root.querySelector("[data-order-chat-form]");
        const input = form?.querySelector("textarea[name='message']");
        form?.scrollIntoView({ block: "center", behavior: "smooth" });
        window.setTimeout(() => input?.focus(), 180);
      });
    });

    this.root.querySelectorAll("[data-order-print-receipt]").forEach((button) => {
      button.addEventListener("click", () => {
        this.store.selectedOrderId = button.dataset.orderPrintReceipt || this.store.selectedOrderId;
        window.print();
      });
    });

    this.root.querySelectorAll("[data-order-scan]").forEach((button) => {
      button.addEventListener("click", () => {
        this.orderScanId = button.dataset.orderScan || null;
        this.render();
      });
    });

    this.root.querySelectorAll("[data-close-order-scan]").forEach((node) => {
      node.addEventListener("click", (event) => {
        if (node.classList.contains("modal-backdrop") && event.target !== node) return;
        this.orderScanId = null;
        this.render();
      });
    });

    this.root.querySelector("[data-order-scan-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const result = this.store.scanOrderItem(String(data.get("orderId") || ""), data.get("code"));
      const done = result.order?.items?.length && result.order.items.every((item) => item.collected);
      if (done) this.orderScanId = null;
      this.showToast(done ? "Все позиции заказа собраны." : result.message);
      if (result.ok && !done) {
        form.reset();
        window.setTimeout(() => this.root.querySelector("[data-order-scan-form] input[name='code']")?.focus(), 160);
      }
    });

    this.root.querySelectorAll("[data-order-action]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const order = this.store.advanceOrder(button.dataset.orderAction);
        if (order) {
          this.showToast(`Заказ #${order.id}: статус изменен на «${order.status}»`);
          this.render();
        } else {
          this.showToast("Не удалось обновить статус заказа. Проверьте, что заказ еще активен.");
        }
      });
    });

    this.root.querySelectorAll("[data-courier-assign]").forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.closest(".courier-assignment");
        const courierName = card?.querySelector("[data-courier-select]")?.value;
        const order = this.store.assignCourier(button.dataset.courierAssign, courierName);
        this.showToast(order ? `К заказу #${order.id} назначен ${order.courierName}` : "Не удалось назначить курьера.");
        if (order) this.render();
      });
    });

    this.root.querySelectorAll("[data-order-cancel]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const order = this.store.cancelOrder(button.dataset.orderCancel);
        this.showToast(order ? `Заказ #${order.id} отменен` : "Этот заказ уже завершен");
        if (order) this.render();
      });
    });

    this.root.querySelectorAll("[data-order-open]").forEach((link) => {
      link.addEventListener("click", () => {
        this.store.selectedOrderId = link.dataset.orderOpen;
      });
    });

    this.root.querySelectorAll("[data-analytics-period]").forEach((button) => {
      button.addEventListener("click", () => {
        this.analyticsPeriod = button.dataset.analyticsPeriod;
        this.render();
      });
    });

    const pricingQuery = this.root.querySelector("[data-pricing-query]");
    const applyPricingPatch = (patch = {}) => {
      const shouldResetPage = !Object.prototype.hasOwnProperty.call(patch, "page");
      this.pricingState = {
        ...this.pricingState,
        ...patch,
        ...(shouldResetPage ? { page: 1 } : {}),
      };
      this.render();
    };
    const applyPricingQuery = () => {
      applyPricingPatch({ query: pricingQuery?.value.trim() || "" });
    };
    let pricingSearchTimer = null;
    pricingQuery?.addEventListener("input", () => {
      window.clearTimeout(pricingSearchTimer);
      pricingSearchTimer = window.setTimeout(applyPricingQuery, 250);
    });
    pricingQuery?.addEventListener("change", applyPricingQuery);
    pricingQuery?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        window.clearTimeout(pricingSearchTimer);
        applyPricingQuery();
      }
    });
    this.root.querySelector("[data-pricing-category]")?.addEventListener("change", (event) => {
      applyPricingPatch({ category: event.currentTarget.value });
    });
    this.root.querySelector("[data-pricing-promotion]")?.addEventListener("change", (event) => {
      applyPricingPatch({ promotion: event.currentTarget.value });
    });
    this.root.querySelectorAll("[data-pricing-page]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        applyPricingPatch({ page: Math.max(1, Number(button.dataset.pricingPage) || 1) });
      });
    });
    this.root.querySelector("[data-pricing-page-size]")?.addEventListener("change", (event) => {
      applyPricingPatch({ pageSize: Math.max(10, Number(event.currentTarget.value) || 20) });
    });
    this.root.querySelector("[data-pricing-reset]")?.addEventListener("click", () => {
      this.pricingState = { query: "", category: "", promotion: "all", page: 1, pageSize: this.pricingState.pageSize || 20 };
      this.render();
    });
    this.root.querySelectorAll("[data-price-form]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const result = this.store.updateProductPricing(form.dataset.priceForm, {
          purchasePrice: data.get("purchasePrice"),
          salePrice: data.get("salePrice"),
        });
        this.showToast(result.ok ? "Цена товара сохранена и опубликована в каталоге." : result.message);
      });
    });
    this.root.querySelector("[data-bulk-price-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const result = this.store.applyBulkPriceChange(data.get("percent"), data.get("category"));
      this.showToast(result.ok ? `Обновлено цен: ${result.count}. Каталог синхронизирован.` : result.message);
    });
    this.root.querySelector("[data-promotion-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const result = this.store.applyPromotion({
        title: data.get("title"),
        category: data.get("category"),
        discount: data.get("discount"),
        endAt: data.get("endAt"),
      });
      this.showToast(result.ok ? `Акция применена к ${result.count} товарам.` : result.message);
    });

    this.root.querySelector("[data-analytics-export]")?.addEventListener("click", () => {
      const rows = this.store.analyticsOrders(this.analyticsPeriod);
      const header = ["ID", "Дата", "Время", "Клиент", "Телефон", "Товары", "Доставка", "Итого", "Статус", "Оплата", "Категория"];
      const csvRows = rows.map((order) => [
        order.id,
        order.date,
        order.time,
        order.client,
        order.phone,
        Array.isArray(order.items) && order.items.length
          ? order.items.reduce((sum, item) => sum + Number(item.price || 0) * (Number(item.quantity) || 1), 0)
          : Math.max(0, Number(order.amount || 0) - Number(order.deliveryFee || 0)),
        order.deliveryFee || 0,
        order.amount,
        order.status,
        order.payment,
        order.category,
      ]);
      this.downloadCsv(`dorigo-analytics-${this.analyticsPeriod}-days.csv`, [header, ...csvRows]);
      this.showToast("Отчет по аналитике экспортирован");
    });

    this.root.querySelector("[data-support-export]")?.addEventListener("click", () => {
      const responses = this.store.reviewResponses();
      const messages = this.store.supportMessages();
      const issueType = (order) => {
        if (order.review?.text) return "Отзыв клиента";
        if (order.status === "Отменен") return "Возврат средств";
        if (Number(order.duration) > 70) return "Контроль доставки";
        if (["Новый", "Подтвержден"].includes(order.status)) return "Ожидает обработки";
        return "Отзыв клиента";
      };
      const rating = (order) => {
        const savedRating = Math.round(Number(order.review?.rating) || 0);
        if (savedRating >= 1 && savedRating <= 5) return savedRating;
        if (order.status === "Отменен") return 2;
        if (Number(order.duration) > 70) return 4;
        return ["Доставлен", "Передан курьеру", "В пути"].includes(order.status) ? 5 : "";
      };
      const header = ["ID заказа", "Клиент", "Телефон", "Статус", "Тип обращения", "Оценка", "Отзыв клиента", "Сумма", "Длительность", "Ответ аптеки", "Дата ответа", "Обновлен"];
      const csvRows = this.store.orders.map((order) => [
        order.id,
        order.client,
        order.phone,
        order.status,
        issueType(order),
        rating(order),
        order.review?.text || "",
        order.amount,
        order.duration,
        responses[order.id]?.response || "",
        responses[order.id]?.updatedAt ? Format.dateTime(responses[order.id].updatedAt) : "",
        Format.dateTime(order.updatedAt || order.createdAt || new Date()),
      ]);
      const chatHeader = ["Чат поддержки", "Автор", "Сообщение", "Дата"];
      const chatRows = messages.map((message, index) => [
        index + 1,
        message.author === "pharmacy" ? "Аптека" : "Поддержка DoriGo",
        message.text,
        Format.dateTime(message.createdAt || new Date()),
      ]);
      const sections = [[header, ...csvRows]];
      if (chatRows.length) sections.push([chatHeader, ...chatRows]);
      this.downloadCsv("dorigo-support-report.csv", sections, { sections: true });
      this.showToast("Отчет поддержки экспортирован");
    });

    this.root.querySelector("[data-review-response-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const orderId = String(data.get("orderId") || "");
      const response = String(data.get("response") || "").trim();
      const result = this.store.saveReviewResponse(orderId, response);
      this.store.selectedSupportReviewId = orderId;
      this.showToast(result.message);
      if (result.ok) this.render();
    });

    this.root.querySelectorAll("[data-review-focus]").forEach((button) => {
      button.addEventListener("click", () => {
        this.store.selectedSupportReviewId = button.dataset.reviewFocus;
        this.render();
      });
    });

    this.root.querySelector("[data-support-chat-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = String(new FormData(form).get("message") || "").trim();
      const result = this.store.sendSupportMessage(message);
      if (result.ok) form.querySelector("input[name='message']").value = "";
      this.showToast(result.message);
      if (result.ok) this.render();
    });

    this.root.querySelector("[data-support-attachment-button]")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.root.querySelector("[data-support-attachment]")?.click();
    });

    this.root.querySelector("[data-support-attachment]")?.addEventListener("change", (event) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        this.showToast("Файл должен быть не больше 5 МБ.");
        input.value = "";
        return;
      }
      const result = this.store.sendSupportAttachment(file);
      input.value = "";
      this.showToast(result.message);
      if (result.ok) this.render();
    });

    this.root.querySelector("[data-category-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const result = this.store.addCategory({
        name: formData.get("name"),
        prescription: formData.get("prescription"),
        online: formData.get("online") === "on",
      });
      this.showToast(result.ok ? "Категория добавлена" : result.message);
      if (result.ok) this.render();
    });

    this.root.querySelectorAll("[data-category-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        this.store.toggleCategory(button.dataset.categoryToggle);
        this.showToast("Доступность категории обновлена");
        this.render();
      });
    });

    this.root.querySelectorAll("[data-category-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        const result = this.store.deleteCategory(button.dataset.categoryDelete);
        this.showToast(result.ok ? "Категория удалена" : result.message);
        if (result.ok) this.render();
      });
    });

    this.root.querySelectorAll("[data-category-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        this.inventoryState = {
          ...this.inventoryState,
          query: "",
          category: button.dataset.categoryFilter,
          status: "all",
          expiry: "all",
        };
        window.location.hash = "#inventory";
      });
    });
  }

  bindSettingsEvents() {
    this.root.querySelector("[data-pharmacy-select]")?.addEventListener("change", (event) => {
      this.accounts.selectPharmacy(event.currentTarget.value);
      this.store.syncActivePharmacyData();
      this.render();
    });

    this.root.querySelectorAll("[data-pharmacy-switch]").forEach((button) => {
      button.addEventListener("click", () => {
        this.accounts.selectPharmacy(button.dataset.pharmacySwitch);
        this.store.syncActivePharmacyData();
        this.render();
      });
    });

    this.root.querySelectorAll(".settings-tabs [data-settings-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        this.settingsTab = button.dataset.settingsTab;
        this.render();
      });
    });

    this.root.querySelector("[data-pharmacy-location]")?.addEventListener("click", () => {
      const pharmacy = this.accounts.activePharmacy();
      if (!pharmacy) return;
      this.openLocationPicker({
        mode: "pharmacy",
        latitude: pharmacy.latitude,
        longitude: pharmacy.longitude,
        address: pharmacy.address,
        zoom: 15,
      });
    });

    const settingsForm = this.root.querySelector("[data-settings-form]");
    settingsForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await this.saveSettingsForm(settingsForm);
      this.showToast(result.message);
    });

    const description = this.root.querySelector("[data-description]");
    description?.addEventListener("input", () => {
      const counter = this.root.querySelector("[data-description-count]");
      if (counter) counter.textContent = String(description.value.length);
    });

    this.root.querySelector("[data-pharmacy-add]")?.addEventListener("click", () => {
      const name = settingsForm?.elements.newPharmacyName?.value.trim();
      const address = settingsForm?.elements.newPharmacyAddress?.value.trim();
      const phone = settingsForm?.elements.newPharmacyPhone?.value.trim();
      if (!name || !address) {
        this.showToast("Укажите название и адрес новой аптеки.");
        return;
      }
      const currentPharmacy = this.accounts.activePharmacy();
      const branchIndex = this.accounts.pharmacies().length;
      const latitudeOffset = 0.0025 + (branchIndex % 3) * 0.002;
      const longitudeOffset = 0.003 + (branchIndex % 4) * 0.0025;
      this.accounts.addPharmacy({
        name,
        address,
        phone,
        manager: this.accounts.currentUser()?.name || "",
        city: currentPharmacy?.city || "Ташкент",
        district: currentPharmacy?.district || "Мирзо-Улугбекский район",
        latitude: Number(currentPharmacy?.latitude || 41.3111) + latitudeOffset,
        longitude: Number(currentPharmacy?.longitude || 69.2797) + longitudeOffset,
        delivery: currentPharmacy?.delivery,
        payments: currentPharmacy?.payments,
      });
      this.store.syncActivePharmacyData();
      this.showToast("Новая аптека добавлена в сеть и выбрана.");
    });

    this.root.querySelector("[data-employee-add]")?.addEventListener("click", () => {
      const name = settingsForm?.elements.employeeName?.value.trim();
      const phone = settingsForm?.elements.employeePhone?.value.trim();
      if (!name || !phone) {
        this.showToast("Укажите имя и телефон сотрудника.");
        return;
      }
      this.accounts.addEmployee({
        name,
        phone,
        role: settingsForm.elements.employeeRole.value,
        access: settingsForm.elements.employeeAccess.value,
      });
      this.showToast("Сотрудник добавлен.");
    });

    this.root.querySelectorAll("[data-employee-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        this.accounts.deleteEmployee(button.dataset.employeeDelete);
        this.showToast("Сотрудник удален.");
      });
    });

    this.root.querySelector("[data-document-input]")?.addEventListener("change", (event) => {
      const file = event.currentTarget.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        this.showToast("Документ должен быть не больше 10 МБ.");
        return;
      }
      this.accounts.addDocument(file);
      this.showToast("Документ добавлен в карточку аптеки.");
    });

    this.root.querySelectorAll("[data-document-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        this.accounts.deleteDocument(button.dataset.documentDelete);
        this.showToast("Документ удален.");
      });
    });

    this.root.querySelector("[data-backup-export]")?.addEventListener("click", () => {
      this.downloadDataBackup();
    });

    const backupInput = this.root.querySelector("[data-backup-input]");
    this.root.querySelector("[data-backup-import]")?.addEventListener("click", () => {
      backupInput?.click();
    });
    backupInput?.addEventListener("change", async () => {
      const file = backupInput.files?.[0];
      if (!file) return;
      try {
        const result = await this.restoreDataBackup(file);
        this.showToast(result.message);
        this.render();
      } catch (error) {
        this.showToast(error.message || "Не удалось восстановить резервную копию.");
      } finally {
        backupInput.value = "";
      }
    });

  }

  bindCourierEvents() {
    this.root.querySelectorAll("[data-courier-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        this.courierView.activeTab = button.dataset.courierTab || "deliveries";
        this.render();
      });
    });

    this.root.querySelectorAll("[data-courier-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        this.courierView.filter = button.dataset.courierFilter || "all";
        this.render();
      });
    });

    this.root.querySelectorAll("[data-courier-order]").forEach((button) => {
      button.addEventListener("click", () => {
        this.store.selectedCourierOrderId = button.dataset.courierOrder;
        if (button.classList.contains("courier-notification")) this.courierView.activeTab = "map";
        this.render();
      });
    });

    this.root.querySelectorAll("[data-courier-refresh]").forEach((button) => {
      button.addEventListener("click", () => {
        this.store.syncActivePharmacyData();
        this.store.refreshMarketplaceProducts();
        const orders = this.store.courierOrders();
        if (this.store.selectedCourierOrderId && !orders.some((order) => order.id === this.store.selectedCourierOrderId)) {
          this.store.selectedCourierOrderId = orders[0]?.id || null;
        }
        this.showToast(`Список доставок обновлен. Активных заказов: ${orders.filter((order) => order.status !== "Доставлен").length}.`);
        this.render();
      });
    });

    this.root.querySelectorAll("[data-courier-payout]").forEach((button) => {
      button.addEventListener("click", () => {
        const result = this.store.requestCourierPayout();
        this.showToast(result.message);
        if (result.ok) this.render();
      });
    });

    this.root.querySelectorAll("[data-courier-pickup]").forEach((button) => {
      button.addEventListener("click", () => {
        const order = this.store.courierAdvanceOrder(button.dataset.courierPickup);
        this.showToast(order ? `Заказ #${order.id} забран. Статус: «В пути».` : "Не удалось обновить заказ.");
        if (order) this.render();
      });
    });

    this.root.querySelectorAll("[data-courier-deliver]").forEach((button) => {
      button.addEventListener("click", () => {
        const code = Array.from(this.root.querySelectorAll(".courier-code input")).map((input) => input.value).join("");
        if (!/^\d{4}$/.test(code)) {
          this.showToast("Введите четырехзначный код клиента.");
          return;
        }
        const note = this.root.querySelector("[data-courier-note]")?.value || "";
        const order = this.store.courierAdvanceOrder(button.dataset.courierDeliver, { code, note });
        this.showToast(order ? `Заказ #${order.id} доставлен клиенту.` : this.store.lastCourierError || "Не удалось завершить заказ.");
        if (order) this.render();
      });
    });

    this.root.querySelectorAll("[data-courier-photo]").forEach((input) => {
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
          this.showToast("Выберите изображение.");
          return;
        }
        if (file.size > 3 * 1024 * 1024) {
          this.showToast("Фото должно быть не больше 3 МБ.");
          return;
        }
        try {
          const dataUrl = await this.readImageAsDataUrl(file);
          const order = this.store.saveCourierPhoto(input.dataset.courierPhoto, dataUrl, file.name);
          this.showToast(order ? `Фото для заказа #${order.id} сохранено.` : "Не удалось сохранить фото.");
          if (order) this.render();
        } catch {
          this.showToast("Не удалось прочитать фотографию.");
        }
      });
    });

    this.root.querySelector("[data-courier-profile]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      this.store.updateCourierProfile({
        name: data.get("name"),
        phone: data.get("phone"),
        transport: data.get("transport"),
        vehicleNumber: data.get("vehicleNumber"),
        online: data.get("online") === "on",
      });
      this.showToast("Профиль курьера сохранен.");
      this.render();
    });

    const codeInputs = this.root.querySelectorAll(".courier-code input");
    codeInputs.forEach((input, index) => {
      input.addEventListener("input", () => {
        input.value = input.value.replace(/\D/g, "").slice(-1);
        if (input.value && codeInputs[index + 1]) codeInputs[index + 1].focus();
      });
    });
  }

  renderAllMapSurfaces() {
    this.root.querySelectorAll("[data-map-surface]").forEach((surface) => this.renderMapSurface(surface));
  }

  renderMapSurface(surface) {
    const tileLayer = surface.querySelector("[data-map-tiles]");
    if (!tileLayer) return;
    const zoom = Math.min(19, Math.max(10, Math.round(Number(surface.dataset.mapZoom) || 14)));
    const center = {
      latitude: Number(surface.dataset.mapLatitude),
      longitude: Number(surface.dataset.mapLongitude),
    };
    if (!Number.isFinite(center.latitude) || !Number.isFinite(center.longitude)) return;
    const width = Math.max(240, Math.round(surface.clientWidth || surface.getBoundingClientRect().width || 0));
    const height = Math.max(160, Math.round(surface.clientHeight || surface.getBoundingClientRect().height || 0));
    const tileSize = MapMath.tileSize;
    const tileCount = 2 ** zoom;
    const centerPx = MapMath.project(center, zoom);
    const topLeftX = centerPx.x - width / 2;
    const topLeftY = centerPx.y - height / 2;
    const startX = Math.floor(topLeftX / tileSize) - 1;
    const endX = Math.floor((topLeftX + width) / tileSize) + 1;
    const startY = Math.max(0, Math.floor(topLeftY / tileSize) - 1);
    const endY = Math.min(tileCount - 1, Math.floor((topLeftY + height) / tileSize) + 1);
    const key = [
      zoom,
      center.latitude.toFixed(6),
      center.longitude.toFixed(6),
      width,
      height,
    ].join(":");

    if (tileLayer.dataset.renderKey !== key) {
      let tiles = "";
      for (let x = startX; x <= endX; x += 1) {
        const wrappedX = ((x % tileCount) + tileCount) % tileCount;
        for (let y = startY; y <= endY; y += 1) {
          const left = Math.round(x * tileSize - topLeftX);
          const top = Math.round(y * tileSize - topLeftY);
          tiles += `<img class="dorigo-map-tile" src="https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png" alt="" draggable="false" loading="lazy" style="left:${left}px;top:${top}px;" />`;
        }
      }
      tileLayer.innerHTML = tiles;
      tileLayer.dataset.renderKey = key;
    }

    surface.querySelectorAll("[data-map-marker]").forEach((marker) => {
      const point = MapMath.pointFromCenter(
        {
          latitude: Number(marker.dataset.latitude),
          longitude: Number(marker.dataset.longitude),
        },
        center,
        zoom,
        width,
        height,
      );
      marker.style.left = `${point.x}px`;
      marker.style.top = `${point.y}px`;
      marker.classList.toggle("is-outside", point.x < -80 || point.y < -80 || point.x > width + 80 || point.y > height + 80);
    });

    this.renderMapRoute(surface, width, height);
  }

  async fetchMapRoute(start, end) {
    const key = `${start.latitude.toFixed(5)},${start.longitude.toFixed(5)}:${end.latitude.toFixed(5)},${end.longitude.toFixed(5)}`;
    if (!this.routeCache) this.routeCache = new Map();
    if (this.routeCache.has(key)) return this.routeCache.get(key);

    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.code !== "Ok" || !data.routes?.[0]) return null;
      
      const routeData = data.routes[0].geometry.coordinates.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
      this.routeCache.set(key, routeData);
      return routeData;
    } catch (error) {
      console.error("Failed to fetch route:", error);
      return null;
    }
  }

  renderMapRoute(surface, width, height) {
    const route = surface.querySelector("[data-map-route-line]");
    if (!route) return;
    
    const markers = [...surface.querySelectorAll("[data-map-marker]")].filter((marker) => !marker.classList.contains("is-outside"));
    if (surface.dataset.mapRoute !== "true" || markers.length < 2) {
      route.innerHTML = "";
      return;
    }

    const zoom = Number(surface.dataset.mapZoom) || 14;
    const center = {
      latitude: Number(surface.dataset.mapLatitude),
      longitude: Number(surface.dataset.mapLongitude),
    };

    const startMarker = markers[0];
    const endMarker = markers[1];
    
    const startCoords = { latitude: Number(startMarker.dataset.latitude), longitude: Number(startMarker.dataset.longitude) };
    const endCoords = { latitude: Number(endMarker.dataset.latitude), longitude: Number(endMarker.dataset.longitude) };

    // Если маршрут уже загружен в кэш, рисуем его
    const key = `${startCoords.latitude.toFixed(5)},${startCoords.longitude.toFixed(5)}:${endCoords.latitude.toFixed(5)},${endCoords.longitude.toFixed(5)}`;
    if (this.routeCache?.has(key)) {
      const pathPoints = this.routeCache.get(key).map(p => MapMath.pointFromCenter(p, center, zoom, width, height));
      const d = pathPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      route.setAttribute("viewBox", `0 0 ${width} ${height}`);
      route.innerHTML = `<path d="${d}" vector-effect="non-scaling-stroke" class="route-line-real"></path>`;
      return;
    }

    // Иначе рисуем временную прямую и запрашиваем реальный маршрут
    this.fetchMapRoute(startCoords, endCoords).then(result => {
      if (result) this.renderMapSurface(surface);
    });

    const p1 = MapMath.pointFromCenter(startCoords, center, zoom, width, height);
    const p2 = MapMath.pointFromCenter(endCoords, center, zoom, width, height);
    route.setAttribute("viewBox", `0 0 ${width} ${height}`);
    route.innerHTML = `<path d="M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}" vector-effect="non-scaling-stroke" class="route-line-temp"></path>`;
  }

  syncLocationPickerSurface(surface) {
    if (!surface || !this.locationPicker) return;
    const centerLatitude = Number.isFinite(Number(this.locationPicker.centerLatitude))
      ? Number(this.locationPicker.centerLatitude)
      : Number(this.locationPicker.latitude);
    const centerLongitude = Number.isFinite(Number(this.locationPicker.centerLongitude))
      ? Number(this.locationPicker.centerLongitude)
      : Number(this.locationPicker.longitude);
    surface.dataset.mapLatitude = String(centerLatitude);
    surface.dataset.mapLongitude = String(centerLongitude);
    surface.dataset.mapZoom = String(this.locationPicker.zoom);
    surface.dataset.latitude = String(centerLatitude);
    surface.dataset.longitude = String(centerLongitude);
    surface.dataset.zoom = String(this.locationPicker.zoom);
    const marker = surface.querySelector("[data-location-marker]");
    if (marker) {
      marker.dataset.latitude = String(this.locationPicker.latitude);
      marker.dataset.longitude = String(this.locationPicker.longitude);
    }
    this.renderMapSurface(surface);
  }

  panLocationPickerMap(surface, dx, dy) {
    if (!this.locationPicker || !surface) return;
    const nextCenter = MapMath.moveCenterByPixels(
      {
        latitude: Number(this.locationPicker.centerLatitude ?? this.locationPicker.latitude),
        longitude: Number(this.locationPicker.centerLongitude ?? this.locationPicker.longitude),
      },
      dx,
      dy,
      this.locationPicker.zoom,
    );
    this.locationPicker.centerLatitude = nextCenter.latitude;
    this.locationPicker.centerLongitude = nextCenter.longitude;
    this.locationPicker.latitude = nextCenter.latitude;
    this.locationPicker.longitude = nextCenter.longitude;
    this.updateLocationPickerDom();
    
    // Автоматически сбрасываем статус при движении
    if (this.locationPicker.status) {
      this.setLocationPickerStatus("", "");
    }
  }

  openLocationPicker(data) {
    this.locationPicker = {
      mode: data.mode === "pharmacy" ? "pharmacy" : "patient",
      latitude: Number(data.latitude) || 41.3111,
      longitude: Number(data.longitude) || 69.2797,
      centerLatitude: Number(data.latitude) || 41.3111,
      centerLongitude: Number(data.longitude) || 69.2797,
      address: String(data.address || ""),
      zoom: Math.min(19, Math.max(11, Number(data.zoom) || 15)),
      status: "",
      statusTone: "",
    };
    this.render();
  }

  captureLocationPickerForm() {
    const form = this.root.querySelector("[data-location-picker-form]");
    if (!form || !this.locationPicker) return;
    const data = new FormData(form);
    const latitude = Number(data.get("latitude"));
    const longitude = Number(data.get("longitude"));
    this.locationPicker.address = String(data.get("address") || "").trim();
    if (Number.isFinite(latitude)) this.locationPicker.latitude = latitude;
    if (Number.isFinite(longitude)) this.locationPicker.longitude = longitude;
  }

  mapCoordinatesFromPoint(clientX, clientY, surface) {
    return MapMath.coordinatesFromScreen(clientX, clientY, surface);
  }

  updateLocationPickerDom(clientX = null, clientY = null) {
    if (!this.locationPicker) return;
    const surface = this.root.querySelector("[data-location-pick-surface]");
    const marker = this.root.querySelector("[data-location-marker]");
    const latitudeInput = this.root.querySelector('[data-location-picker-form] input[name="latitude"]');
    const longitudeInput = this.root.querySelector('[data-location-picker-form] input[name="longitude"]');
    const coordinate = this.root.querySelector("[data-location-coordinate]");
    const externalLink = this.root.querySelector('.location-picker-controls a[target="_blank"]');
    if (latitudeInput) latitudeInput.value = this.locationPicker.latitude.toFixed(6);
    if (longitudeInput) longitudeInput.value = this.locationPicker.longitude.toFixed(6);
    if (coordinate) coordinate.textContent = `${this.locationPicker.latitude.toFixed(6)}, ${this.locationPicker.longitude.toFixed(6)}`;
    if (externalLink) {
      externalLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${this.locationPicker.latitude},${this.locationPicker.longitude}`)}`;
    }
    if (surface && marker) this.syncLocationPickerSurface(surface);
    if (surface && marker && Number.isFinite(clientX) && Number.isFinite(clientY)) surface.classList.add("location-has-selection");
  }

  setLocationFromMapPoint(clientX, clientY, surface) {
    const rect = surface.getBoundingClientRect();
    const clampedX = Math.min(rect.right, Math.max(rect.left, clientX));
    const clampedY = Math.min(rect.bottom, Math.max(rect.top, clientY));
    const coordinates = this.mapCoordinatesFromPoint(clampedX, clampedY, surface);
    this.locationPicker.latitude = coordinates.latitude;
    this.locationPicker.longitude = coordinates.longitude;
    this.locationPicker.centerLatitude = coordinates.latitude;
    this.locationPicker.centerLongitude = coordinates.longitude;
    this.updateLocationPickerDom(clampedX, clampedY);
  }

  setLocationPickerStatus(message, tone = "") {
    if (this.locationPicker) {
      this.locationPicker.status = message;
      this.locationPicker.statusTone = tone;
    }
    const status = this.root.querySelector("[data-location-status]");
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  async searchLocationAddress(reverse = false) {
    if (!this.locationPicker) return;
    const addressInput = this.root.querySelector('[data-location-picker-form] input[name="address"]');
    const query = String(addressInput?.value || "").trim();
    const endpoint = reverse
      ? `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ru&lat=${encodeURIComponent(this.locationPicker.latitude)}&lon=${encodeURIComponent(this.locationPicker.longitude)}`
      : `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=uz&accept-language=ru&bounded=1&viewbox=69.05,41.45,69.55,41.10&q=${encodeURIComponent(query)}`;
    if (!reverse && query.length < 3) {
      this.setLocationPickerStatus("Введите хотя бы 3 символа адреса.", "error");
      addressInput?.focus();
      return;
    }
    this.setLocationPickerStatus(reverse ? "Определяем адрес выбранной точки..." : "Ищем адрес...", "loading");
    try {
      const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const result = reverse ? data : data[0];
      if (!result || !Number.isFinite(Number(result.lat)) || !Number.isFinite(Number(result.lon))) {
        this.setLocationPickerStatus("Адрес не найден. Уточните запрос или выберите точку на карте.", "error");
        return;
      }
      this.locationPicker.latitude = Number(result.lat);
      this.locationPicker.longitude = Number(result.lon);
      this.locationPicker.centerLatitude = this.locationPicker.latitude;
      this.locationPicker.centerLongitude = this.locationPicker.longitude;
      this.locationPicker.address = String(result.display_name || query).trim();
      this.locationPicker.zoom = Math.max(16, this.locationPicker.zoom);
      if (addressInput) addressInput.value = this.locationPicker.address;
      this.setLocationPickerStatus("Точка найдена. Проверьте её на карте и сохраните.", "success");
      this.render();
    } catch {
      this.setLocationPickerStatus("Сервис адресного поиска сейчас недоступен. Выберите точку на карте вручную.", "error");
    }
  }

  bindLocationPickerEvents() {
    if (!this.locationPicker) return;
    this.root.querySelectorAll("[data-close-location-picker]").forEach((node) => {
      node.addEventListener("click", (event) => {
        if (node.classList.contains("location-picker-backdrop") && event.target !== node) return;
        event.preventDefault();
        this.locationPicker = null;
        this.render();
      });
    });

    const surface = this.root.querySelector("[data-location-pick-surface]");
    const marker = this.root.querySelector("[data-location-marker]");
    let markerDragging = false;
    let markerMoved = false;
    let panMoved = false;

    surface?.addEventListener("click", (event) => {
      if (markerMoved || panMoved || event.target.closest("[data-location-marker]")) {
        markerMoved = false;
        panMoved = false;
        return;
      }
      this.captureLocationPickerForm();
      this.setLocationFromMapPoint(event.clientX, event.clientY, surface);
      this.setLocationPickerStatus("Точка выбрана. При необходимости перетащите маркер точнее.", "success");
    });

    surface?.addEventListener("pointerdown", (event) => {
      if (event.target.closest("[data-location-marker]")) return;
      event.preventDefault();
      this.captureLocationPickerForm();
      let previousX = event.clientX;
      let previousY = event.clientY;
      let totalMove = 0;
      panMoved = false;
      surface.setPointerCapture?.(event.pointerId);
      surface.classList.add("location-is-panning");

      const moveMap = (moveEvent) => {
        const dx = moveEvent.clientX - previousX;
        const dy = moveEvent.clientY - previousY;
        totalMove += Math.abs(dx) + Math.abs(dy);
        if (totalMove > 4) panMoved = true;
        previousX = moveEvent.clientX;
        previousY = moveEvent.clientY;
        if (panMoved) this.panLocationPickerMap(surface, dx, dy);
      };

      const finishPan = () => {
        surface.classList.remove("location-is-panning");
        window.removeEventListener("pointermove", moveMap);
        window.removeEventListener("pointerup", finishPan);
        window.removeEventListener("pointercancel", finishPan);
        if (panMoved) {
          this.setLocationPickerStatus("Определяем адрес...", "");
          this.searchLocationAddress(true);
        }
      };

      window.addEventListener("pointermove", moveMap);
      window.addEventListener("pointerup", finishPan);
      window.addEventListener("pointercancel", finishPan);
    });

    marker?.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      markerDragging = true;
      markerMoved = false;
      marker.setPointerCapture?.(event.pointerId);
      surface?.classList.add("location-is-dragging");

      const moveMarker = (moveEvent) => {
        if (!markerDragging) return;
        markerMoved = true;
        const rect = surface.getBoundingClientRect();
        const x = Math.min(rect.width, Math.max(0, moveEvent.clientX - rect.left));
        const y = Math.min(rect.height, Math.max(0, moveEvent.clientY - rect.top));
        marker.style.left = `${x}px`;
        marker.style.top = `${y}px`;
      };

      const finishMarkerDrag = (finishEvent) => {
        if (!markerDragging) return;
        markerDragging = false;
        surface?.classList.remove("location-is-dragging");
        window.removeEventListener("pointermove", moveMarker);
        window.removeEventListener("pointerup", finishMarkerDrag);
        window.removeEventListener("pointercancel", finishMarkerDrag);
        if (markerMoved) {
          this.captureLocationPickerForm();
          this.setLocationFromMapPoint(finishEvent.clientX, finishEvent.clientY, surface);
          this.setLocationPickerStatus("Маркер перемещён. Можно определить адрес точки.", "success");
        }
      };

      window.addEventListener("pointermove", moveMarker);
      window.addEventListener("pointerup", finishMarkerDrag);
      window.addEventListener("pointercancel", finishMarkerDrag);
    });

    surface?.addEventListener("keydown", (event) => {
      const directions = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      if (!directions[event.key]) return;
      event.preventDefault();
      const [vertical, horizontal] = directions[event.key];
      const step = 360 / (256 * (2 ** this.locationPicker.zoom)) * (event.shiftKey ? 40 : 10);
      this.locationPicker.latitude = Math.min(85, Math.max(-85, this.locationPicker.latitude - vertical * step));
      this.locationPicker.longitude = ((this.locationPicker.longitude + horizontal * step + 540) % 360) - 180;
      this.locationPicker.centerLatitude = this.locationPicker.latitude;
      this.locationPicker.centerLongitude = this.locationPicker.longitude;
      this.render();
    });

    this.root.querySelectorAll("[data-location-zoom]").forEach((button) => {
      button.addEventListener("click", () => {
        this.captureLocationPickerForm();
        this.locationPicker.zoom = Math.min(19, Math.max(11, this.locationPicker.zoom + Number(button.dataset.locationZoom)));
        this.render();
      });
    });

    this.root.querySelector("[data-location-center]")?.addEventListener("click", () => {
      this.captureLocationPickerForm();
      this.locationPicker.latitude = 41.3111;
      this.locationPicker.longitude = 69.2797;
      this.locationPicker.centerLatitude = 41.3111;
      this.locationPicker.centerLongitude = 69.2797;
      this.locationPicker.zoom = 14;
      this.setLocationPickerStatus("Карта возвращена к центру Ташкента.");
      this.render();
    });

    this.root.querySelector("[data-location-search]")?.addEventListener("click", () => {
      this.captureLocationPickerForm();
      this.searchLocationAddress(false);
    });
    this.root.querySelector('[data-location-picker-form] input[name="address"]')?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.captureLocationPickerForm();
      this.searchLocationAddress(false);
    });
    this.root.querySelector("[data-location-reverse]")?.addEventListener("click", () => {
      this.captureLocationPickerForm();
      this.searchLocationAddress(true);
    });

    const coordinateInputs = this.root.querySelectorAll('[data-location-picker-form] input[name="latitude"], [data-location-picker-form] input[name="longitude"]');
    coordinateInputs.forEach((input) => {
      input.addEventListener("change", () => {
        this.captureLocationPickerForm();
        this.locationPicker.centerLatitude = this.locationPicker.latitude;
        this.locationPicker.centerLongitude = this.locationPicker.longitude;
        this.render();
      });
    });

    this.root.querySelector("[data-location-current]")?.addEventListener("click", (event) => {
      const button = event.currentTarget;
      if (!navigator.geolocation) {
        this.showToast("Геолокация не поддерживается этим браузером.");
        return;
      }
      this.captureLocationPickerForm();
      button.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.locationPicker.latitude = position.coords.latitude;
          this.locationPicker.longitude = position.coords.longitude;
          this.locationPicker.centerLatitude = this.locationPicker.latitude;
          this.locationPicker.centerLongitude = this.locationPicker.longitude;
          this.locationPicker.zoom = 17;
          this.render();
        },
        () => {
          button.disabled = false;
          this.showToast("Не удалось получить геолокацию. Разрешите браузеру доступ к местоположению.");
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
      );
    });

    this.root.querySelector("[data-location-picker-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.captureLocationPickerForm();
      const { mode, latitude, longitude, address } = this.locationPicker;
      if (![latitude, longitude].every(Number.isFinite)) {
        this.showToast("Укажите корректные координаты.");
        return;
      }
      if (mode === "pharmacy") {
        this.accounts.updateActivePharmacy({ latitude, longitude, address });
        this.store.syncActivePharmacyData();
        this.store.syncPharmacyOrdersWithLocation();
        this.locationPicker = null;
        this.showToast("Точка аптеки сохранена. Маршруты и расстояния обновлены.");
        return;
      }
      this.store.setCustomerLocation({
        latitude,
        longitude,
        address,
        label: address || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
        source: "map",
      });
      this.locationPicker = null;
      this.showToast("Точка доставки сохранена. Расстояния до аптек пересчитаны.");
    });
  }

  async saveSettingsForm(form) {
    const tab = form.dataset.settingsTab;
    const data = new FormData(form);
    const checked = (name) => Boolean(form.elements[name]?.checked);
    let patch = {};

    if (tab === "profile") {
      patch = {
        name: String(data.get("name") || "").trim(),
        branchCode: String(data.get("branchCode") || "").trim(),
        address: String(data.get("address") || "").trim(),
        city: String(data.get("city") || "").trim(),
        district: String(data.get("district") || "").trim(),
        phone: String(data.get("phone") || "").trim(),
        email: String(data.get("email") || "").trim(),
        manager: String(data.get("manager") || "").trim(),
        description: String(data.get("description") || "").trim(),
        latitude: Number(data.get("latitude")) || 0,
        longitude: Number(data.get("longitude")) || 0,
        bank: {
          iban: String(data.get("iban") || "").trim(),
          name: String(data.get("bankName") || "").trim(),
          tin: String(data.get("tin") || "").trim(),
          mfo: String(data.get("mfo") || "").trim(),
          recipient: String(data.get("recipient") || "").trim(),
        },
      };
      const logo = form.elements.logo?.files?.[0];
      if (logo) {
        if (logo.size > 2 * 1024 * 1024) return { ok: false, message: "Логотип должен быть не больше 2 МБ." };
        patch.logoData = await this.readImageAsDataUrl(logo);
      }
    } else if (tab === "hours") {
      const hours = {};
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].forEach((day) => {
        hours[day] = {
          enabled: checked(`${day}Enabled`),
          open: String(data.get(`${day}Open`) || "09:00"),
          close: String(data.get(`${day}Close`) || "18:00"),
        };
      });
      patch = { hours };
    } else if (tab === "delivery") {
      patch = {
        delivery: {
          enabled: checked("deliveryEnabled"),
          pickup: checked("pickup"),
          minOrder: Number(data.get("minOrder")) || 0,
          assemblyMinutes: Number(data.get("assemblyMinutes")) || 0,
          radius: Number(data.get("radius")) || 0,
          fee: Number(data.get("fee")) || 0,
        },
      };
    } else if (tab === "payments") {
      patch = { payments: { cash: checked("cash"), click: checked("click"), card: checked("card"), payme: checked("payme") } };
    } else if (tab === "notifications") {
      patch = {
        notifications: {
          orders: checked("orders"),
          lowStock: checked("lowStock"),
          system: checked("system"),
          reviews: checked("reviews"),
          marketing: checked("marketing"),
        },
      };
    }

    this.accounts.updateActivePharmacy(patch);
    if (tab === "profile") this.store.syncPharmacyOrdersWithLocation();
    return { ok: true, message: "Настройки аптеки сохранены." };
  }

  readImageAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));
      reader.readAsDataURL(file);
    });
  }

  bindInventoryEvents() {
    this.root.querySelectorAll("[data-product-add]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.productModalOpen = true;
        this.productDraft = {};
        this.catalogMatches = [];
        this.render();
      });
    });

    this.root.querySelectorAll("[data-product-add-catalog]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        if (this.accounts.currentUser()?.type !== "pharmacy") {
          this.authMode = "login";
          this.authType = "pharmacy";
          this.authReturnRoute = "partner";
          this.render();
          return;
        }
        const product = this.store.catalogProducts.find((item) => item.id === button.dataset.productAddCatalog)
          || this.store.productById(button.dataset.productAddCatalog);
        if (!product) {
          this.showToast("Карточка препарата не найдена в едином каталоге.");
          return;
        }
        this.openProductOfferModal(product);
      });
    });

    this.root.querySelectorAll("[data-inventory-refresh]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const result = this.store.refreshInventorySync();
        this.showToast(result.ok ? `Остатки обновлены: ${result.count} позиций. Каталог клиента синхронизирован.` : result.message);
      });
    });

    const applyInventoryFilter = (patch = {}) => {
      const shouldResetPage = !Object.prototype.hasOwnProperty.call(patch, "page");
      this.inventoryState = {
        ...this.inventoryState,
        ...patch,
        ...(shouldResetPage ? { page: 1 } : {}),
      };
      this.render();
    };
    const inventoryQuery = this.root.querySelector("[data-inventory-query]");
    let inventorySearchTimer = null;
    inventoryQuery?.addEventListener("input", () => {
      window.clearTimeout(inventorySearchTimer);
      inventorySearchTimer = window.setTimeout(() => {
        applyInventoryFilter({ query: inventoryQuery.value.trim() });
      }, 250);
    });
    inventoryQuery?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        window.clearTimeout(inventorySearchTimer);
        applyInventoryFilter({ query: inventoryQuery.value.trim() });
      }
    });
    this.root.querySelector("[data-inventory-category]")?.addEventListener("change", (event) => {
      applyInventoryFilter({ category: event.target.value });
    });
    this.root.querySelector("[data-inventory-status]")?.addEventListener("change", (event) => {
      applyInventoryFilter({ status: event.target.value || "all" });
    });
    this.root.querySelector("[data-inventory-expiry]")?.addEventListener("change", (event) => {
      applyInventoryFilter({ expiry: event.target.value || "all" });
    });
    this.root.querySelectorAll("[data-inventory-page]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        applyInventoryFilter({ page: Math.max(1, Number(button.dataset.inventoryPage) || 1) });
      });
    });
    this.root.querySelector("[data-inventory-page-size]")?.addEventListener("change", (event) => {
      applyInventoryFilter({ pageSize: Math.max(10, Number(event.currentTarget.value) || 20) });
    });
    this.root.querySelectorAll("[data-inventory-reset]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        applyInventoryFilter({ query: "", category: "", status: "all", expiry: "all", page: 1 });
      });
    });

    this.root.querySelectorAll("[data-product-edit]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const product = this.store.catalogProducts.find((item) => item.id === button.dataset.productEdit);
        if (!product) {
          this.showToast("Единая карточка товара не найдена");
          return;
        }
        this.openProductOfferModal(product);
      });
    });

    this.root.querySelectorAll("[data-product-publish]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const nextPublished = button.dataset.published !== "1";
        const result = this.store.setOfferPublished(button.dataset.productPublish, nextPublished);
        this.showToast(result.message);
        if (result.ok) this.render();
      });
    });

    this.root.querySelectorAll("[data-close-product]").forEach((node) => {
      node.addEventListener("click", (event) => {
        if (node.classList.contains("product-backdrop") && event.target !== node) return;
        event.preventDefault();
        this.productModalOpen = false;
        this.productDraft = {};
        this.catalogMatches = [];
        this.render();
      });
    });

    const productForm = this.root.querySelector("[data-product-form]");
    const catalogQueryInput = this.root.querySelector("[data-catalog-query]");
    const applyCatalogFilter = () => {
      this.productDraft = this.captureProductDraft(productForm);
      this.productDraft.catalogQuery = catalogQueryInput?.value.trim() || "";
      this.render();
    };
    this.root.querySelector("[data-catalog-filter]")?.addEventListener("click", applyCatalogFilter);
    catalogQueryInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyCatalogFilter();
      }
    });

    this.root.querySelector("[data-catalog-select]")?.addEventListener("change", (event) => {
      this.productDraft = this.captureProductDraft(productForm);
      const selected = this.store.catalogProducts.find((product) => product.id === event.target.value);
      if (!selected) {
        this.productDraft.catalogId = "";
        this.productDraft.catalogSearchDone = false;
        this.catalogMatches = [];
        this.render();
        return;
      }
      this.catalogMatches = [selected];
      this.productDraft.catalogSearchDone = true;
      this.applyCatalogProductToDraft(selected);
      this.render();
    });

    productForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const draft = this.captureProductDraft(productForm);
      const result = this.store.addPharmacyOffer(draft);
      if (!result.ok) {
        this.showToast(result.message);
        return;
      }
      this.productModalOpen = false;
      this.productDraft = {};
      this.catalogMatches = [];
      this.store.selectedProductId = result.offer.catalogId || result.offer.id;
      this.store.highlightedOfferId = result.offer.pharmacyId ? `${result.offer.pharmacyId}:${result.offer.id}` : "";
      this.store.selectedOfferId = this.store.highlightedOfferId || this.store.selectedOfferId;
      this.showToast(result.updated
        ? "Цена и остаток товара обновлены. Витрина синхронизирована."
        : "Предложение аптеки добавлено и уже видно на витрине.");
    });

    const excelInput = this.root.querySelector("[data-excel-input]");
    this.root.querySelector("[data-excel-template]")?.addEventListener("click", () => this.downloadCurrentPrice());
    this.root.querySelector("[data-excel-upload]")?.addEventListener("click", () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx, .xls, .csv';
      input.onchange = (e) => this.handleExcelUpload(e.target.files[0]);
      input.click();
    });

    this.root.querySelectorAll("[data-catalog-reference]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.downloadCatalogReference();
      });
    });

    this.root.querySelector("[data-excel-error-report]")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.downloadImportErrorReport(this.importSummary);
    });

    this.root.querySelectorAll("[data-inventory-export]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.downloadInventoryExport();
      });
    });

    this.root.querySelectorAll("[data-excel-upload]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        excelInput?.click();
      });
    });

    excelInput?.addEventListener("change", async () => {
      const file = excelInput.files?.[0];
      if (!file) return;
      try {
        this.validateSpreadsheetFile(file);
        const rows = await this.readSpreadsheet(file);
        this.importSummary = this.store.importPharmacyRows(rows.map((row) => this.mapImportRow(row)), { fileName: file.name });
        this.render();
      } catch (error) {
        const message = error.message || "Не удалось прочитать файл";
        this.store.recordSyncEvent(`Ошибка загрузки Excel${file?.name ? `: ${file.name}` : ""}`, "Ошибка", message);
        this.showToast(message);
      } finally {
        excelInput.value = "";
      }
    });

    this.root.querySelectorAll("[data-close-import]").forEach((node) => {
      node.addEventListener("click", (event) => {
        if (node.classList.contains("modal-backdrop") && event.target !== node) return;
        event.preventDefault();
        this.importSummary = null;
        this.render();
      });
    });
  }

  captureProductDraft(form) {
    if (!form) return {};
    const formData = new FormData(form);
    return {
      catalogId: String(formData.get("catalogId") || "").trim(),
      catalogQuery: String(formData.get("catalogQuery") || "").trim(),
      price: String(formData.get("price") || "").trim(),
      purchasePrice: String(formData.get("purchasePrice") || "").trim(),
      stock: String(formData.get("stock") || "").trim(),
      barcode: String(formData.get("barcode") || "").trim(),
      expiry: String(formData.get("expiry") || "").trim(),
    };
  }

  openProductOfferModal(product) {
    if (!product?.id) return;
    this.productModalOpen = true;
    this.productDraft = { catalogId: product.id, catalogQuery: product.name };
    this.catalogMatches = [product];
    this.applyCatalogProductToDraft(product);
    if (this.currentRoute() !== "inventory") {
      this.inventoryState = { ...this.inventoryState, query: product.name || "", page: 1 };
    }
    this.render();
  }

  applyCatalogProductToDraft(product) {
    this.productDraft.catalogId = product.id;
    const existing = this.store.pharmacyInventory.find((offer) => offer.catalogId === product.id);
    if (existing) {
      this.productDraft.price = this.productDraft.price || existing.price;
      this.productDraft.purchasePrice = this.productDraft.purchasePrice || existing.purchasePrice;
      this.productDraft.stock = this.productDraft.stock || existing.stock;
      this.productDraft.expiry = this.productDraft.expiry || existing.expiry;
      this.productDraft.barcode = this.productDraft.barcode || existing.barcode;
    }
  }

  async readProductImages(files) {
    return Promise.all(files.map(async (file) => ({
      data: await this.readProductImage(file),
      name: file.name,
    })));
  }

  async readProductImage(file) {
    if (!file.type.startsWith("image/")) throw new Error("Можно загружать только изображения");
    if (file.size > 8 * 1024 * 1024) throw new Error("Исходное фото должно быть не больше 8 МБ");
    const source = await this.readImageAsDataUrl(file);
    const image = await new Promise((resolve, reject) => {
      const preview = new Image();
      preview.onload = () => resolve(preview);
      preview.onerror = () => reject(new Error("Не удалось обработать фотографию"));
      preview.src = source;
    });
    const render = (maxSize, quality) => {
      const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Браузер не смог подготовить фотографию");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", quality);
    };
    let optimized = render(1400, 0.82);
    if (optimized.length > 850 * 1024) optimized = render(1000, 0.68);
    if (optimized.length > 1100 * 1024) throw new Error("Фотография слишком сложная. Выберите изображение меньшего размера");
    return optimized;
  }

  backupStorageKeys() {
    return [...new Set([
      this.accounts.usersKey,
      this.accounts.sessionKey,
      this.accounts.workspaceKey,
      this.store.catalogContentKey,
      this.store.inventoryKey,
      this.store.inventoryMigrationKey,
      this.store.categoryKey,
      this.store.orderKey,
      this.store.customerLocationKey,
      this.store.courierProfileKey,
    ].filter(Boolean))];
  }

  downloadBlob(filename, body, type = "application/octet-stream") {
    const blob = body instanceof Blob ? body : new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  csvQuote(value) {
    return `"${String(value ?? "")
      .replace(/\r?\n|\r/g, " ")
      .replaceAll('"', '""')}"`;
  }

  csvSection(rows) {
    return rows.map((row) => row.map((value) => this.csvQuote(value)).join(";")).join("\r\n");
  }

  downloadCsv(filename, rows, options = {}) {
    const sections = options.sections ? rows : [rows];
    const csv = `\uFEFF${sections.map((section) => this.csvSection(section)).join("\r\n\r\n")}`;
    this.downloadBlob(filename, csv, "text/csv;charset=utf-8");
  }

  downloadCurrentPrice() {
    const pharmacy = this.accounts.activePharmacy();
    if (!pharmacy) return;

    const data = pharmacy.inventory.map(item => ({
      'DoriGo ID': item.catalogId,
      'Регистрационный номер': item.regNumber || '',
      'Штрихкод / GTIN': item.barcode || '',
      'Название': item.name,
      'МНН': item.mnn || '',
      'Дозировка': item.dosage || '',
      'Форма': item.form || '',
      'Производитель': item.manufacturer || '',
      'Серия': item.series || '',
      'Срок годности': Format.expiryLabel(item.expiry),
      'Цена': item.price,
      'Остаток': item.stock,
      'Аптека': pharmacy.name,
      'Адрес филиала': pharmacy.address
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Прайс-лист DoriGo");
    
    const fileName = `DoriGo_Inventory_${pharmacy.name.replace(/\s+/g, '_')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  }

  async handleExcelUpload(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet);

      const result = this.store.importPharmacyRows(rows.map(row => ({
        catalogId: row['DoriGo ID'],
        regNumber: row['Регистрационный номер'],
        barcode: row['Штрихкод / GTIN'] || row['Штрихкод'],
        name: row['Название'],
        series: row['Серия'],
        price: row['Цена'],
        stock: row['Остаток'],
        expiry: row['Срок годности']
      })));

      this.render();
      this.showToast(
        result.errors > 0 
          ? `Обработано ${result.uploaded} строк. Ошибок: ${result.errors}. Проверьте отчет.` 
          : `Успешно обновлено ${result.updated + result.added} позиций.`,
        result.errors > 0 ? "error" : "success"
      );
    };
    reader.readAsArrayBuffer(file);
  }

  async syncInventoryByUrl() {
    const pharmacy = this.accounts.activePharmacy();
    if (!pharmacy || !pharmacy.syncUrl) return { ok: false, message: "Ссылка для синхронизации не указана" };

    this.recordSyncEvent("Запуск авто-синхронизации", "В процессе", `URL: ${pharmacy.syncUrl}`);

    try {
      const response = await fetch(pharmacy.syncUrl);
      if (!response.ok) throw new Error(`Ошибка загрузки: ${response.status}`);
      
      const data = await response.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet);

      const result = this.importPharmacyRows(rows.map(row => ({
        catalogId: row['ID DoriGo'] || row['ID'] || row['id'],
        name: row['Название'] || row['Наименование'] || row['Name'],
        price: row['Цена'] || row['Стоимость'] || row['Price'],
        stock: row['Остаток'] || row['Количество'] || row['Stock'],
        expiry: row['Срок годности'] || row['Срок'] || row['Expiry'],
        barcode: row['Штрихкод'] || row['Barcode']
      })), { skipSyncLog: true });

      this.recordSyncEvent(
        "Авто-синхронизация завершена", 
        result.errors > 0 ? "С ошибками" : "Успешно", 
        `Обновлено: ${result.updated}, Ошибок: ${result.errors}`
      );

      return { ok: true, result };
    } catch (error) {
      this.recordSyncEvent("Ошибка авто-синхронизации", "Ошибка", error.message);
      return { ok: false, message: error.message };
    }
  }

  recordSyncEvent(event, status, details) {
    const pharmacy = this.accounts.activePharmacy();
    if (!pharmacy) return;
    if (!pharmacy.syncEvents) pharmacy.syncEvents = [];
    
    pharmacy.syncEvents.unshift({
      id: Date.now(),
      event,
      status,
      details,
      timestamp: new Date().toISOString()
    });
    
    if (pharmacy.syncEvents.length > 50) pharmacy.syncEvents.pop();
    this.accounts.saveUsers();
  }

  async restoreDataBackup(file) {
    if (!file) throw new Error("Выберите JSON-файл резервной копии.");
    if (!String(file.name || "").toLowerCase().endsWith(".json")) {
      throw new Error("Резервная копия должна быть JSON-файлом DoriGo.");
    }
    if (!file.size) throw new Error("Файл резервной копии пуст.");
    if (file.size > 6 * 1024 * 1024) throw new Error("Файл резервной копии должен быть не больше 6 МБ.");
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      throw new Error("Не удалось прочитать JSON. Проверьте файл резервной копии.");
    }
    if (payload?.schema !== "dorigo-local-backup" || !payload.data || typeof payload.data !== "object") {
      throw new Error("Это не похоже на резервную копию DoriGo.");
    }
    const allowed = new Set(this.backupStorageKeys());
    let restored = 0;
    Object.entries(payload.data).forEach(([key, value]) => {
      if (!allowed.has(key)) return;
      if (value === null || value === undefined) {
        window.localStorage.removeItem(key);
      } else if (typeof value === "string") {
        window.localStorage.setItem(key, value);
      } else {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
      restored += 1;
    });
    if (!restored) throw new Error("В файле нет разделов данных, которые можно восстановить.");
    this.rebuildRuntimeFromStorage();
    this.settingsTab = "notifications";
    return { ok: true, message: `Резервная копия восстановлена: ${restored} разделов. Интерфейс обновлен.` };
  }

  rebuildRuntimeFromStorage() {
    this.accounts = new AccountService();
    this.store = new DoriGoStore(this.accounts);
    this.publicViews = new PublicViews(this.store);
    this.dashboardViews = new DashboardViews(this.store);
    this.courierView = new CourierView(this.store);
    this.searchState = this.defaultSearchState();
    this.productDraft = {};
    this.catalogMatches = [];
    this.importSummary = null;
    this.store.selectedPartnerOrders = new Set();
    this.orderState = { tab: "Все", query: "", dateFrom: "", dateTo: "", type: "all", sort: "newest", page: 1, pageSize: 10 };
    this.inventoryState = { query: "", category: "", status: "all", expiry: "all", page: 1, pageSize: 20 };
    this.pricingState = { query: "", category: "", promotion: "all", page: 1, pageSize: 20 };
  }

  validateSpreadsheetFile(file) {
    if (!file) throw new Error("Выберите файл Excel или CSV.");
    const name = String(file.name || "").toLowerCase();
    const allowed = [".xlsx", ".xls", ".csv", ".tsv"];
    if (!allowed.some((ext) => name.endsWith(ext))) {
      throw new Error("Поддерживаются только файлы .xlsx, .xls, .csv или .tsv.");
    }
    if (!file.size) throw new Error("Файл пуст. Скачайте шаблон и заполните строки товаров.");
    if (file.size > 8 * 1024 * 1024) throw new Error("Файл должен быть не больше 8 МБ.");
  }

  async readSpreadsheet(file) {
    if (!window.XLSX) throw new Error("Модуль Excel не загрузился. Обновите страницу.");
    if (file.size > 8 * 1024 * 1024) throw new Error("Файл должен быть не больше 8 МБ.");
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: "array", cellDates: false });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) throw new Error("В файле нет листов с товарами");
    const rows = window.XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: false })
      .filter((row) => Object.values(row).some((value) => String(value || "").trim()));
    if (!rows.length) throw new Error("Файл пуст или в нем нет строк товаров");
    return rows;
  }

  downloadExcelTemplate() {
    const headers = ["ID DoriGo", "Штрихкод", "Название", "МНН", "Дозировка", "Форма", "Количество в упаковке", "Производитель", "Категория", "Цена", "Закупочная цена", "Остаток", "Рецептурность", "Срок годности"];
    const rows = [
      ["ibuprofen-200", "478001000001", "Ибупрофен", "Ибупрофен", "200 мг", "Таблетки", "N20", "Фармак", "Обезболивающие", "6000", "4200", "12", "Без рецепта", "12.2026"],
      ["paracetamol-500-n20", "478001000002", "Парацетамол", "Парацетамол", "500 мг", "Таблетки", "N20", "Фармак", "Жаропонижающие", "2000", "1100", "20", "Без рецепта", "10.2026"],
    ];
    if (window.XLSX) {
      const worksheet = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
      worksheet["!cols"] = headers.map((header) => ({ wch: Math.max(14, header.length + 4) }));
      const workbook = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(workbook, worksheet, "Товары");
      window.XLSX.writeFile(workbook, "dorigo-pharmacy-import-template.xlsx");
      this.showToast("Шаблон Excel скачан. Заполните цены, остатки и загрузите файл обратно.");
      return;
    }
    this.downloadCsv("dorigo-pharmacy-import-template.csv", [headers, ...rows]);
    this.showToast("Шаблон Excel скачан. Заполните цены, остатки и загрузите файл обратно.");
  }

  downloadCatalogReference() {
    const catalog = this.store.catalogProducts
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru")
        || String(a.dosage || "").localeCompare(String(b.dosage || ""), "ru")
        || String(a.packageSize || "").localeCompare(String(b.packageSize || ""), "ru"));
    if (!catalog.length) {
      this.showToast("Единый каталог пока не загружен.");
      return;
    }
    const headers = ["ID DoriGo", "Название", "МНН", "Дозировка", "Форма", "Количество в упаковке", "Производитель", "Страна", "Категория", "Рецептурность", "Регистрационный номер"];
    const rows = catalog.map((product) => [
      product.id || "",
      product.name || "",
      product.mnn || product.ingredient || "",
      product.dosage || "",
      product.form || "",
      product.packageSize || "",
      product.manufacturer || "",
      product.country || "",
      product.category || "",
      product.prescriptionStatus || (product.rxRequired ? "По рецепту" : "Без рецепта"),
      product.registrationNumber || "",
    ]);
    if (window.XLSX) {
      const worksheet = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
      worksheet["!cols"] = headers.map((header) => ({ wch: Math.max(14, Math.min(34, header.length + 6)) }));
      const workbook = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(workbook, worksheet, "Справочник DoriGo");
      window.XLSX.writeFile(workbook, `dorigo-catalog-reference-${new Date().toISOString().slice(0, 10)}.xlsx`);
      this.showToast(`Справочник ID DoriGo скачан: ${catalog.length} карточек.`);
      return;
    }
    this.downloadCsv(`dorigo-catalog-reference-${new Date().toISOString().slice(0, 10)}.csv`, [headers, ...rows]);
    this.showToast(`Справочник ID DoriGo скачан: ${catalog.length} карточек.`);
  }

  downloadInventoryExport() {
    const inventory = this.store.pharmacyInventory.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
    if (!inventory.length) {
      this.downloadExcelTemplate();
      this.showToast("Склад пуст. Скачан шаблон для первого заполнения.");
      return;
    }
    const headers = ["ID DoriGo", "Штрихкод", "Название", "МНН", "Дозировка", "Форма", "Количество в упаковке", "Производитель", "Категория", "Цена", "Закупочная цена", "Остаток", "Резерв", "Доступно", "Рецептурность", "Срок годности", "Опубликован"];
    const rows = inventory.map((product) => {
      const available = Math.max(0, Number(product.stock) - Number(product.reserve || 0));
      return [
        product.catalogId || product.id || "",
        product.barcode || "",
        product.name || "",
        product.mnn || product.ingredient || "",
        product.dosage || "",
        product.form || "",
        product.packageSize || "",
        product.manufacturer || "",
        product.category || "",
        Number(product.price) || 0,
        Number(product.purchasePrice) || "",
        Number(product.stock) || 0,
        Number(product.reserve) || 0,
        available,
        product.prescriptionStatus || product.prescription || "",
        Format.expiryLabel(product.expiry),
        product.published === false ? "Нет" : "Да",
      ];
    });
    if (window.XLSX) {
      const worksheet = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
      worksheet["!cols"] = headers.map((header) => ({ wch: Math.max(12, Math.min(32, header.length + 6)) }));
      const workbook = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(workbook, worksheet, "Прайс аптеки");
      window.XLSX.writeFile(workbook, `dorigo-inventory-${new Date().toISOString().slice(0, 10)}.xlsx`);
      this.showToast("Текущий прайс-лист скачан.");
      return;
    }
    this.downloadCsv(`dorigo-inventory-${new Date().toISOString().slice(0, 10)}.csv`, [headers, ...rows]);
    this.showToast("Текущий прайс-лист скачан.");
  }

  downloadImportErrorReport(summary) {
    const rows = Array.isArray(summary?.problemRows) ? summary.problemRows : [];
    if (!rows.length) {
      this.showToast("В последнем импорте нет строк с ошибками.");
      return;
    }
    const headers = ["Строка", "Тип ошибки", "Причина", "ID DoriGo", "Штрихкод", "Название", "МНН", "Дозировка", "Форма", "Количество в упаковке", "Цена", "Закупочная цена", "Остаток", "Срок годности"];
    const dataRows = rows.map((row) => [
      row.line,
      row.type,
      row.reason,
      row.catalogId,
      row.barcode,
      row.name,
      row.mnn,
      row.dosage,
      row.form,
      row.packageSize,
      row.price,
      row.purchasePrice,
      row.stock,
      row.expiry,
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    this.downloadCsv(`dorigo-import-errors-${stamp}.csv`, [headers, ...dataRows]);
    this.showToast("Отчёт ошибок скачан. Исправьте строки и загрузите файл повторно.");
  }

  mapImportRow(row) {
    const normalized = new Map();
    Object.entries(row).forEach(([key, value]) => {
      const normalizedKey = String(key)
        .trim()
        .toLowerCase()
        .replaceAll("ё", "е")
        .replace(/[^\p{L}\p{N}]+/gu, "");
      normalized.set(normalizedKey, value);
    });
    const pick = (...aliases) => {
      for (const alias of aliases) {
        const value = normalized.get(alias);
        if (value !== undefined && value !== "") return value;
      }
      return "";
    };

    return {
      catalogId: pick("iddorigo", "dorigoid", "idтовара", "idпрепарата", "catalogid", "catalog", "id"),
      barcode: pick("штрихкод", "штрихкодтовара", "код", "кодтовара", "barcode", "bar", "ean", "gtin"),
      name: pick("название", "наименование", "наименованиетовара", "товар", "препарат", "лекарство", "name", "product"),
      mnn: pick("мнн", "мнндействующеевещество", "действующеевещество", "активноевещество", "ingredient", "mnn", "inn"),
      dosage: pick("дозировка", "доза", "strength", "dosage"),
      form: pick("форма", "формавыпуска", "лекарственнаяформа", "form"),
      packageSize: pick("количествовупаковке", "упаковка", "фасовка", "номер", "pack", "packagesize", "package"),
      manufacturer: pick("производитель", "изготовитель", "manufacturer", "producer"),
      category: pick("категория", "группа", "category") || "Прочее",
      price: pick("цена", "ценасум", "ценапродажи", "розничнаяцена", "price", "saleprice"),
      purchasePrice: pick("закупочнаяцена", "ценазакупки", "себестоимость", "purchaseprice", "cost"),
      stock: pick("остаток", "остатокшт", "остатки", "остатокнаскладе", "количество", "колвосклад", "stock", "quantity", "qty"),
      prescription: pick("рецептурность", "рецепт", "prescription", "rx") || "Без рецепта",
      expiry: pick("срокгодности", "годендо", "срокгодностидо", "expiry", "expiration", "expirationdate"),
    };
  }

  bindSearchShortcuts() {
    const publicSearch = this.root.querySelector("[data-public-search]");
    if (publicSearch) {
      publicSearch.value = this.searchState.query || "";
      publicSearch.addEventListener("keydown", (event) => {
        if (event.key === "Enter") this.openSearch(publicSearch.value);
      });
    }

    const homeSearch = this.root.querySelector("[data-home-search]");
    const homeSubmit = this.root.querySelector("[data-home-search-submit]");
    const submitHomeSearch = () => this.openSearch(homeSearch?.value || "");
    homeSubmit?.addEventListener("click", submitHomeSearch);
    homeSearch?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submitHomeSearch();
    });
  }

  bindAdminCatalogEvents() {
    const form = this.root.querySelector("[data-admin-catalog-form]");
    const productId = form?.elements.productId?.value || "";
    const product = this.store.catalogProducts.find((item) => item.id === productId) || null;
    if (product && this.adminCatalogImagesProductId !== product.id) {
      this.adminCatalogImages = Ui.productImages(product);
      this.adminCatalogImagesProductId = product.id;
    }

    const search = this.root.querySelector("[data-admin-catalog-search]");
    const applySearch = () => {
      this.adminCatalogState.query = search?.value.trim() || "";
      this.adminCatalogState.selectedId = "";
      this.adminCatalogImages = [];
      this.adminCatalogImagesProductId = "";
      this.render();
    };
    search?.addEventListener("change", applySearch);
    search?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applySearch();
      }
    });

    this.root.querySelectorAll("[data-admin-catalog-select]").forEach((button) => {
      button.addEventListener("click", () => {
        this.adminCatalogState.selectedId = button.dataset.adminCatalogSelect;
        this.adminCatalogImages = [];
        this.adminCatalogImagesProductId = "";
        this.render();
      });
    });

    this.root.querySelector("[data-admin-catalog-images]")?.addEventListener("change", async (event) => {
      const files = Array.from(event.target.files || []);
      if (!files.length) return;
      if (this.adminCatalogImages.length + files.length > 6) {
        this.showToast("В центральной галерее может быть не больше 6 фотографий");
        return;
      }
      try {
        this.adminCatalogImages = [...this.adminCatalogImages, ...await this.readProductImages(files)];
        this.render();
      } catch (error) {
        this.showToast(error.message);
      }
    });

    this.root.querySelectorAll("[data-admin-image-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        this.adminCatalogImages = this.adminCatalogImages.filter((_, index) => index !== Number(button.dataset.adminImageRemove));
        this.render();
      });
    });

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const images = this.adminCatalogImages;
      const result = this.store.saveCatalogProductContent(data.productId, {
        name: String(data.name || "").trim(),
        mnn: String(data.mnn || "").trim(),
        ingredient: String(data.mnn || "").trim(),
        dosage: String(data.dosage || "").trim(),
        form: String(data.form || "").trim(),
        packageSize: String(data.packageSize || "").trim(),
        category: String(data.category || "").trim(),
        fullTradeName: String(data.fullTradeName || "").trim(),
        dosageFormDetails: String(data.dosageFormDetails || "").trim(),
        pharmacotherapeuticGroup: String(data.pharmacotherapeuticGroup || "").trim(),
        manufacturer: String(data.manufacturer || "").trim(),
        country: String(data.country || "").trim(),
        registrationNumber: String(data.registrationNumber || "").trim(),
        registrationDate: String(data.registrationDate || "").trim(),
        registrationChangeDate: String(data.registrationChangeDate || "").trim(),
        atcCode: String(data.atcCode || "").trim(),
        prescriptionStatus: String(data.prescriptionStatus || "Не указано"),
        rxRequired: data.prescriptionStatus === "По рецепту",
        description: String(data.description || "").trim(),
        usage: String(data.usage || "").trim(),
        composition: String(data.composition || "").trim(),
        indications: String(data.indications || "").trim(),
        contraindications: String(data.contraindications || "").trim(),
        storageConditions: String(data.storageConditions || "").trim(),
        sourceName: String(data.sourceName || "").trim(),
        sourceUrl: String(data.sourceUrl || "").trim(),
        instructionUrl: String(data.instructionUrl || "").trim(),
        sourceUpdatedAt: String(data.sourceUpdatedAt || "").trim(),
        sourceVerified: form.elements.sourceVerified.checked,
        images,
        imageData: images[0]?.data || "",
        photoName: images[0]?.name || "",
      });
      this.showToast(result.message);
    });
  }

  bindAdminDashboardEvents() {
    this.root.querySelector("[data-admin-export]")?.addEventListener("click", (event) => {
      event.preventDefault();
      const rows = this.store.accounts.marketplacePharmacies().map(({ organization, pharmacy }) => {
        const inventory = Array.isArray(pharmacy.inventory) ? pharmacy.inventory : [];
        const orders = Array.isArray(pharmacy.orders) ? pharmacy.orders : [];
        const completed = orders.filter((order) => order.status === "Доставлен");
        return [
          pharmacy.id,
          organization,
          pharmacy.name,
          pharmacy.city || "Ташкент",
          pharmacy.district || "",
          inventory.length,
          inventory.filter((item) => item.published !== false && Number(item.stock) > 0).length,
          inventory.filter((item) => Number(item.stock) <= 0).length,
          orders.length,
          completed.length,
          completed.reduce((sum, order) => sum + Number(order.amount || 0), 0),
        ];
      });
      this.downloadCsv("dorigo-admin-snapshot.csv", [[
        "ID аптеки",
        "Организация",
        "Аптека",
        "Город",
        "Район",
        "SKU",
        "Активные предложения",
        "Без остатка",
        "Заказы",
        "Доставлено",
        "Выручка",
      ], ...rows]);
      this.showToast(`Экспортировано аптек: ${rows.length}`);
    });

    this.root.querySelectorAll("[data-admin-product-approve]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const result = this.store.approveMarketplaceOffer(
          button.dataset.adminPharmacyId,
          button.dataset.adminProductApprove,
        );
        this.showToast(result.message);
        if (result.ok) this.render();
      });
    });
  }

  bindCatalogEvents() {
    this.root.querySelectorAll("[data-product-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        this.productTab = button.dataset.productTab;
        this.render();
      });
    });

    this.root.querySelectorAll("[data-gallery-image]").forEach((button) => {
      button.addEventListener("click", () => {
        const image = button.querySelector("img");
        const mainImage = this.root.querySelector(".product-gallery-main-image");
        if (!image || !mainImage) return;
        mainImage.src = image.src;
        mainImage.alt = image.alt;
        this.root.querySelectorAll("[data-gallery-image]").forEach((item) => item.classList.toggle("active", item === button));
      });
    });

    this.root.querySelectorAll("[data-sort]").forEach((button) => {
      button.addEventListener("click", () => {
        this.searchState.sort = button.dataset.sort;
        this.searchState.page = 1;
        this.render();
      });
    });

    this.root.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        this.searchState.view = button.dataset.view;
        this.searchState.page = 1;
        this.render();
      });
    });

    this.root.querySelectorAll("[data-filter-type]").forEach((input) => {
      input.addEventListener("change", () => {
        this.updateSetFilter(input.dataset.filterType, input.value, input.checked);
        this.searchState.page = 1;
        this.render();
      });
    });

    this.root.querySelectorAll("[data-toggle]").forEach((input) => {
      input.addEventListener("change", () => {
        this.searchState[input.dataset.toggle] = input.checked;
        this.searchState.page = 1;
        this.render();
      });
    });

    const queryInput = this.root.querySelector("[data-search-query]");
    queryInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        this.searchState.query = queryInput.value.trim();
        this.searchState.page = 1;
        this.render();
      }
    });
    queryInput?.addEventListener("change", () => {
      this.searchState.query = queryInput.value.trim();
      this.searchState.page = 1;
      this.render();
    });

    const minPrice = this.root.querySelector("[data-price-min]");
    const maxPrice = this.root.querySelector("[data-price-max]");
    minPrice?.addEventListener("change", () => {
      this.searchState.minPrice = minPrice.value;
      this.searchState.page = 1;
      this.render();
    });
    maxPrice?.addEventListener("change", () => {
      this.searchState.maxPrice = maxPrice.value;
      this.searchState.page = 1;
      this.render();
    });

    this.root.querySelectorAll("[data-catalog-page]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        this.searchState.page = Math.max(1, Number(button.dataset.catalogPage) || 1);
        this.render();
        window.requestAnimationFrame(() => {
          this.root.querySelector(".catalog-products")?.scrollIntoView({ block: "start", behavior: "smooth" });
        });
      });
    });

    this.root.querySelector("[data-clear-filters]")?.addEventListener("click", () => {
      this.searchState = this.defaultSearchState();
      this.render();
    });
  }

  updateSetFilter(type, value, checked) {
    const set = this.searchState[type];
    if (!set) return;
    if (checked) set.add(value);
    else set.delete(value);
  }

  openSearch(query) {
    this.searchState.query = query.trim();
    this.searchState.page = 1;
    if (this.currentRoute() === "search") {
      this.render();
      return;
    }
    window.location.hash = "#search";
  }

  showToast(text) {
    this.toast = text;
    window.clearTimeout(this.toastTimer);
    this.render();
    this.toastTimer = window.setTimeout(() => {
      this.toast = "";
      this.render();
    }, 2200);
  }
}

window.DoriGoApp = DoriGoApp;

function bootDoriGo() {
  new DoriGoApp(document.querySelector("#app")).start();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootDoriGo);
} else {
  bootDoriGo();
}
