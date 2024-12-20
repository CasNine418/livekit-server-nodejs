/**
 * 深拷贝
 * @param source 原数据，可以是原始值、一般对象、数组、Map、Set、Date等
 */
function deepcopy<T>(source: T): T {
    const cache: WeakMap<any, any> = new WeakMap<any, any>();
    
    /**
     * 深拷贝数组
     * @param source
     */
    const copyArray = (source: any[]): any[] => {
        const result: any[] = [];
        cache.set(source, result);
        source.forEach((item) => {
            result.push(dfs(item));
        });
        return result;
    };
    
    /**
     * 深拷贝集合
     * @param source
     */
    const copySet = (source: Set<any>): Set<any> => {
        const result: Set<any> = new Set<any>();
        cache.set(source, result);
        source.forEach((item) => {
            result.add(dfs(item));
        });
        return result;
    };
    
    /**
     * 深拷贝映射
     * @param source
     */
    const copyMap = (source: Map<any, any>): Map<any, any> => {
        const result: Map<any, any> = new Map<any, any>();
        cache.set(source, result);
        source.forEach((value, key) => {
            result.set(key, dfs(value));
        });
        return result;
    };
    
    /**
     * 拷贝正则表达式
     * @param source
     */
    const copyRegExp = (source: RegExp): any => {
        const result: RegExp = new RegExp(source.source, source.flags);
        result.lastIndex = source.lastIndex;
        return result;
    }
    
    /**
     * 深拷贝对象
     * @param source
     */
    const copyObject = (source: any): object | null => {
        if (source === null) {
            return null;
        }
        
        const Ctor = source.constructor;
        switch (Ctor) {
            case Array: {
                return copyArray(source);
            }
            case Map: {
                return copyMap(source);
            }
            case Set: {
                return copySet(source);
            }
            case Date:
            case Number:
            case String: {
                return copyByCtor(Ctor, source);
            }
            case Boolean: {
                return copyByCtor(Ctor, source.valueOf());
            }
            case RegExp: {
                return copyRegExp(source);
            }
            default: {
                break;
            }
        }
        
        const result: object = Object.create(Reflect.getPrototypeOf(source));
        cache.set(source, result);
        
        // 拷贝所有属性描述符
        for (const key of Reflect.ownKeys(source)) {
            const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
            if (descriptor) {
                const newDescriptor = { ...descriptor };
                if ("value" in descriptor) {
                    newDescriptor.value = dfs(source[key]);
                }
                Reflect.defineProperty(result, key, newDescriptor);
            }
        }
        
        return result;
    };
    
    /**
     * 拷贝Date
     * @param Ctor
     * @param source
     */
    const copyByCtor = <T, R>(Ctor: { new(source: T): R }, source: T): R => {
        return new Ctor(source);
    };
    
    /**
     * 深度优先遍历
     * @param source
     */
    const dfs = (source: any): any => {
        if (typeof source !== "object") {
            return source;
        }
        
        if (cache.has(source)) {
            return cache.get(source);
        }
        
        return copyObject(source);
    };
    
    return dfs(source);
}

export default deepcopy;