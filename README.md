# Moto Trials (рабочее название)

2D мотокросс-игра с физикой в духе Mad Skills Motocross. Платформы: веб и Android (через Capacitor).

Играть: https://novokshonovpv.github.io/gggame/ — обновляется автоматически при каждом пуше в `main` (`.github/workflows/pages.yml`).

Стек: TypeScript + Vite, физика Planck.js (Box2D), 3D-графика three.js (запасной 2D-рендер на Canvas: `?2d` в адресе).

## Команды

```bash
npm install
npm run dev          # игра на http://localhost:5173
npm run build        # проверка типов + сборка в dist/
npm run build:share  # одна страница dist/share.html для публикации ссылкой
node tools/sim.ts    # прогон трасс автопилотом без браузера
node tools/feel.ts   # стандартные манёвры для настройки физики
node tools/race.ts   # полная гонка с соперниками без браузера (баланс)
```

Управление: ↑ газ, ↓ тормоз, ← → наклон, R заново, Esc меню. На телефоне — экранные кнопки.

## Облачное сохранение (Firebase)

Прогресс (монеты, улучшения, раскраски, задания, рекорды, призраки) синхронизируется через
Firebase после входа через Google. Пока в `src/cloud-config.ts` стоит `null`, облако скрыто.

1. https://console.firebase.google.com → «Создать проект» (Google Analytics не нужен).
2. Build → Authentication → Get started → Sign-in method → Google → Enable.
3. Authentication → Settings → Authorized domains → добавить `novokshonovpv.github.io`.
4. Build → Firestore Database → Create database (production mode, регион `eur3`).
5. Firestore → Rules → вставить содержимое `firestore.rules` → Publish.
6. Project settings → Your apps → Web (`</>`) → зарегистрировать приложение и скопировать `firebaseConfig`
   в `src/cloud-config.ts`.

Данные: `users/{uid}` — прогресс, `users/{uid}/ghosts/{trackId}` — призраки. Объединение прогресса
с разных устройств — `src/progress.ts` (проверка: `node tools/merge-test.ts`).

## Структура

- `src/bike.ts` — физика байка, все параметры «ощущения» в объекте `BIKE`
- `src/track.ts` — конструктор трасс из MX-элементов (столы, дабблы, роллеры, ступени) и сами трассы
- `src/render3d.ts` — 3D-сцена: объёмная трасса, байки и гонщики из 3D-деталей, тени, фон из планов
- `src/render.ts` — 2D-отрисовка (запасной вариант) трассы (объёмная полоса, срез грунта, забор), байка и гонщика
- `src/scenery.ts` — темы трасс и параллакс-фоны (каньон, лес, ночной город)
- `src/race.ts` — гонка: соперники, круги, респавн после падения, позиции
- `src/cloud.ts`, `src/progress.ts` — облачное сохранение: вход через Google, Firestore, объединение прогресса
- `src/ghost.ts` — призрак рекорда: запись позы байка 30 раз в секунду, сохранение и воспроизведение
- `src/audio.ts` — весь звук синтезом (Web Audio): моторы с передачами, приземления, падения, сигналы, музыка
- `src/garage.ts` — прокачка: монеты, улучшения байка (двигатель, резина, подвеска, баланс), раскраски, награды за гонку
- `src/missions.ts` — задания трасс (вилли, бэкфлипы, полёт, место, время, без падений)
- `src/ai.ts` — автопилот, на нём ездят соперники
- `src/main.ts` — игровой цикл, состояния, интерфейс
