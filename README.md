# وصلة — تطبيق موبايل

تطبيق محادثات عربي للأندرويد بنُسخة موبايل من تطبيق وصلة الويب.

## البدء السريع

### المتطلبات
- **Node.js 18+** و **npm/pnpm**
- **Android Studio** (اختياري للتطوير المتقدم)
- **Expo CLI**

### التثبيت والتشغيل

```bash
# 1. تثبيت المتطلبات
npm install
# أو
pnpm install

# 2. تشغيل التطبيق على المحاكي
npm run android

# 3. تشغيل على جهازك (بعد تثبيت Expo Go من متجر البلايستور)
npx expo start
# ثم امسح QR code بكاميرا هاتفك
```

## بناء APK

### الطريقة 1: استخدام EAS Build (الموصى به)

```bash
# 1. تثبيت EAS CLI
npm install -g eas-cli

# 2. تسجيل الدخول
eas login

# 3. بناء APK
eas build --platform android

# 4. تثبيت على الجهاز
eas build:run --platform android
```

### الطريقة 2: بناء محلي (بدون سحابة)

```bash
# يتطلب Android SDK مثبت محليًا
npm run build:apk
```

## الهيكل

```
src/
├── api/          # وظائف التواصل مع الخادم
├── components/   # مكونات React Native
├── screens/      # الشاشات الرئيسية
├── store/        # إدارة الحالة (Zustand)
└── types/        # أنواع TypeScript

App.tsx          # نقطة الدخول الرئيسية
app.json         # إعدادات Expo
```

## متغيرات البيئة

أنشئ ملف `.env` بالعناصر التالية:

```env
EXPO_PUBLIC_API_URL=http://your-server.com/api
EXPO_PUBLIC_APP_NAME=وصلة
```

## خوادم الاختبار

```bash
# تشغيل خادم التطوير
npm run start

# اختبار على Android Virtual Device
npm run android

# اختبار على iOS (إذا كنت على Mac)
npm run ios
```

## الميزات

✅ المحادثات الحية
✅ الطلبات والتطبيقات
✅ الرسائل المحفوظة
✅ التزامن التلقائي
✅ واجهة عربية RTL
✅ دعم الصور والملفات

## المزيد من المعلومات

- [Expo Documentation](https://docs.expo.dev)
- [React Native Documentation](https://reactnative.dev)
- [Zustand Store](https://github.com/pmndrs/zustand)
