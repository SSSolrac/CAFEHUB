import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@/lib/errors';
import { inventoryService } from '@/services/inventoryService';
import type { InventoryCategory, InventoryItem } from '@/types/inventory';

export const useInventory = () => {
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextCategories, nextItems] = await Promise.all([inventoryService.listCategories(), inventoryService.listItems()]);
      const visibleCategoryIds = new Set(nextCategories.map((category) => category.id));
      const visibleItems = nextItems.filter((item) => visibleCategoryIds.has(item.categoryId));
      setCategories(nextCategories);
      setItems(visibleItems);
    } catch (loadError) {
      console.error('Failed to load inventory', loadError);
      setCategories([]);
      setItems([]);
      setError(getErrorMessage(loadError, 'Unable to load inventory tracker.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const saveCategory = useCallback(async (category: InventoryCategory) => {
    const saved = await inventoryService.saveCategory(category);
    setCategories((rows) => (rows.some((row) => row.id === saved.id) ? rows.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...rows]));
    return saved;
  }, []);

  const deleteCategory = useCallback(async (id: string) => {
    await inventoryService.deleteCategory(id);
    setCategories((rows) => rows.filter((row) => row.id !== id));
  }, []);

  const saveItem = useCallback(async (item: InventoryItem) => {
    const saved = await inventoryService.saveItem(item);
    setItems((rows) => (rows.some((row) => row.id === saved.id) ? rows.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...rows]));
    return saved;
  }, []);

  const deleteItem = useCallback(async (id: string) => {
    await inventoryService.deleteItem(id);
    setItems((rows) => rows.filter((row) => row.id !== id));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { categories, items, loading, error, saveCategory, deleteCategory, saveItem, deleteItem, refresh: load };
};
