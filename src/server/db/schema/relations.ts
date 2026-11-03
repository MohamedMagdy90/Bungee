import { relations } from "drizzle-orm";
import { dependents, users } from "./auth";
import { creditLedger, customerPackages, orderItems, orders, payments, productClassTypes, productPrices, products } from "./commerce";
import { bookings, classSessions, scheduleTemplates } from "./schedule";
import { branches, branchGallery, branchHours, classTypes, coaches, media } from "./studio";

export const branchesRelations = relations(branches, ({ one, many }) => ({
  cover: one(media, { fields: [branches.coverMediaId], references: [media.id] }),
  hours: many(branchHours),
  gallery: many(branchGallery),
  sessions: many(classSessions),
}));

export const branchHoursRelations = relations(branchHours, ({ one }) => ({
  branch: one(branches, { fields: [branchHours.branchId], references: [branches.id] }),
}));

export const branchGalleryRelations = relations(branchGallery, ({ one }) => ({
  branch: one(branches, { fields: [branchGallery.branchId], references: [branches.id] }),
  media: one(media, { fields: [branchGallery.mediaId], references: [media.id] }),
}));

export const coachesRelations = relations(coaches, ({ one }) => ({
  photo: one(media, { fields: [coaches.photoMediaId], references: [media.id] }),
  branch: one(branches, { fields: [coaches.primaryBranchId], references: [branches.id] }),
  user: one(users, { fields: [coaches.userId], references: [users.id] }),
}));

export const classTypesRelations = relations(classTypes, ({ one }) => ({
  cover: one(media, { fields: [classTypes.coverMediaId], references: [media.id] }),
}));

export const scheduleTemplatesRelations = relations(scheduleTemplates, ({ one }) => ({
  branch: one(branches, { fields: [scheduleTemplates.branchId], references: [branches.id] }),
  classType: one(classTypes, { fields: [scheduleTemplates.classTypeId], references: [classTypes.id] }),
  coach: one(coaches, { fields: [scheduleTemplates.coachId], references: [coaches.id] }),
}));

export const classSessionsRelations = relations(classSessions, ({ one, many }) => ({
  branch: one(branches, { fields: [classSessions.branchId], references: [branches.id] }),
  classType: one(classTypes, { fields: [classSessions.classTypeId], references: [classTypes.id] }),
  coach: one(coaches, { fields: [classSessions.coachId], references: [coaches.id] }),
  template: one(scheduleTemplates, { fields: [classSessions.templateId], references: [scheduleTemplates.id] }),
  bookings: many(bookings),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  session: one(classSessions, { fields: [bookings.sessionId], references: [classSessions.id] }),
  user: one(users, { fields: [bookings.userId], references: [users.id] }),
  dependent: one(dependents, { fields: [bookings.dependentId], references: [dependents.id] }),
  customerPackage: one(customerPackages, { fields: [bookings.customerPackageId], references: [customerPackages.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  dependents: many(dependents),
  bookings: many(bookings),
  packages: many(customerPackages),
  orders: many(orders),
}));

export const dependentsRelations = relations(dependents, ({ one }) => ({
  guardian: one(users, { fields: [dependents.guardianUserId], references: [users.id] }),
}));

export const productsRelations = relations(products, ({ many, one }) => ({
  prices: many(productPrices),
  classTypes: many(productClassTypes),
  image: one(media, { fields: [products.imageMediaId], references: [media.id] }),
}));

export const productPricesRelations = relations(productPrices, ({ one }) => ({
  product: one(products, { fields: [productPrices.productId], references: [products.id] }),
}));

export const productClassTypesRelations = relations(productClassTypes, ({ one }) => ({
  product: one(products, { fields: [productClassTypes.productId], references: [products.id] }),
  classType: one(classTypes, { fields: [productClassTypes.classTypeId], references: [classTypes.id] }),
}));

export const customerPackagesRelations = relations(customerPackages, ({ one, many }) => ({
  user: one(users, { fields: [customerPackages.userId], references: [users.id] }),
  product: one(products, { fields: [customerPackages.productId], references: [products.id] }),
  ledger: many(creditLedger),
}));

export const creditLedgerRelations = relations(creditLedger, ({ one }) => ({
  customerPackage: one(customerPackages, { fields: [creditLedger.customerPackageId], references: [customerPackages.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  items: many(orderItems),
  payments: many(payments),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));
