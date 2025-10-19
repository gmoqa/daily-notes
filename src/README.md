# Frontend - TypeScript Application

Este directorio contiene el código frontend de la aplicación Daily Notes, completamente migrado a TypeScript con las mejores prácticas.

## 📁 Estructura del Proyecto

```
src/
├── components/     # Componentes UI (Calendar, Editor, Notifications, UI)
├── services/       # Lógica de negocio y llamadas API
├── utils/          # Utilidades (state, cache, events, sync)
├── types/          # Definiciones de tipos TypeScript
└── main.ts         # Punto de entrada de la aplicación
```

## 🚀 Scripts Disponibles

```bash
# Desarrollo
npm run dev          # Servidor de desarrollo con hot reload (puerto 5173)

# Build
npm run build        # Compilar TypeScript y generar bundle de producción
npm run preview      # Preview del build de producción

# Calidad de código
npm run typecheck    # Verificar tipos sin compilar
npm run lint         # Lint del código
npm run lint:fix     # Lint y auto-fix
npm run format       # Format código con Prettier
npm run format:check # Verificar formato

# Testing
npm test             # Ejecutar tests
npm run test:watch   # Tests en modo watch
npm run test:coverage # Tests con coverage
```

## 🛠️ Tecnologías

- **TypeScript** - Type safety y mejor DX
- **Vite** - Build tool rápido
- **ESLint + Prettier** - Linting y formatting
- **Path Aliases** - Imports limpios con `@components`, `@services`, etc.

## 📦 Build Output

El build genera archivos optimizados en `static/dist/`:

- `js/main-[hash].js` - Bundle principal
- `js/utils-[hash].js` - Chunk de utilidades
- `js/*-legacy-[hash].js` - Polyfills para navegadores antiguos
- `.vite/manifest.json` - Manifest para templates

## 🎯 Mejores Prácticas Implementadas

### 1. **Arquitectura Modular**
```typescript
// Usa path aliases para imports limpios
import { state } from '@utils/state'
import { api } from '@services/api'
import { calendar } from '@components/Calendar'
```

### 2. **Tipado Fuerte**
```typescript
interface SyncOperation {
  id?: number
  type: 'save-note' | 'delete-note' | 'create-context'
  data: any
}
```

### 3. **Event Bus Tipado**
```typescript
events.emit(EVENT.NOTE_SAVED, { context, date, content })
```

### 4. **Code Splitting**
El build automáticamente separa el código en chunks:
- Vendor: librerías de node_modules
- Utils: utilidades compartidas
- Main: código de la aplicación

## 🔧 Configuración

### TypeScript (`tsconfig.json`)
- Target: ES2020
- Module: ESNext
- Bundler mode resolution
- Path mapping para imports limpios

### Vite (`vite.config.ts`)
- Proxy API `/api` → `localhost:3000`
- Legacy browser support
- Code splitting optimizado
- Minificación con Terser

### ESLint (`eslint.config.js`)
- TypeScript rules
- Prettier integration
- Custom globals

### Prettier (`.prettierrc`)
- Sin punto y coma
- Single quotes
- Tab width: 2
- Print width: 100

## 📝 Notas de Migración

Este frontend fue migrado de JavaScript vanilla a TypeScript manteniendo toda la funcionalidad:

- ✅ **245 dependencias → 10 dependencias**
- ✅ Migrado `sync.js` a TypeScript con tipos
- ✅ Path aliases configurados
- ✅ ESLint + Prettier configurado
- ✅ Build optimizado con code splitting
- ✅ Legacy browser support

## 🚦 Próximos Pasos

1. Habilitar `strict: true` en tsconfig y fix tipos
2. Agregar más tests unitarios
3. Implementar Storybook para components
4. Agregar bundle analyzer
5. Considerar migrar a un framework (React/Vue/Svelte) si crece

## 📚 Recursos

- [TypeScript Docs](https://www.typescriptlang.org/docs/)
- [Vite Docs](https://vitejs.dev/)
- [ESLint Docs](https://eslint.org/)
- [Prettier Docs](https://prettier.io/)
