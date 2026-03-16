import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Trash2, DollarSign, Calculator, HardHat, Receipt, Search, ListTodo, Edit2, X, Check, LogIn, LogOut, Loader2, Upload, Mail, Lock, Camera } from 'lucide-react';
import { supabase } from './supabase';
import { User } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { GoogleGenAI, Type } from '@google/genai';

interface Expense {
  id: string;
  description: string;
  observation?: string;
  total_value: number;
  partner_value: number;
  date: string;
  created_by: string;
  created_at: string;
}

interface Task {
  id: string;
  text: string;
  completed: boolean;
  created_by: string;
  created_at: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [description, setDescription] = useState('');
  const [observation, setObservation] = useState('');
  const [totalValue, setTotalValue] = useState('');
  const [partnerValue, setPartnerValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editObs, setEditObs] = useState('');
  const [editTotal, setEditTotal] = useState('');
  const [editPartner, setEditPartner] = useState('');
  
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskText, setNewTaskText] = useState('');
  const [loginError, setLoginError] = useState('');
  const [migrationMessage, setMigrationMessage] = useState('');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const [expenseToDelete, setExpenseToDelete] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleAuthChange(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleAuthChange(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleAuthChange = async (currentUser: User | null) => {
    setUser(currentUser);
    if (currentUser) {
      try {
        // Ensure user exists in public.users table (upsert)
        await supabase.from('users').upsert({
          id: currentUser.id,
          email: currentUser.email,
          name: currentUser.user_metadata?.full_name || currentUser.email,
        }, { onConflict: 'id', ignoreDuplicates: true });

        fetchData();
      } catch (e) {
        console.error("Error saving user:", e);
        fetchData();
      }
    } else {
      setExpenses([]);
      setTasks([]);
    }
    setAuthLoading(false);
  };

  const fetchData = async () => {
    const { data: exps } = await supabase.from('expenses').select('*').order('date', { ascending: false });
    if (exps) setExpenses(exps as Expense[]);

    const { data: tsks } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    if (tsks) {
      const sortedTasks = (tsks as Task[]).sort((a, b) => {
        if (a.completed === b.completed) {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
        return a.completed ? 1 : -1;
      });
      setTasks(sortedTasks);
    }
  };

  const forceMigrateLocalData = async () => {
    if (!user) return;
    try {
      setMigrationMessage('Procurando dados antigos no seu navegador...');
      const getLocalData = (baseKey: string) => {
        const keys = [`${baseKey}-v4`, `${baseKey}-v3`, `${baseKey}-v2`, `${baseKey}-v1`, baseKey];
        for (const key of keys) {
          const data = localStorage.getItem(key);
          if (data) {
            try {
              const parsed = JSON.parse(data);
              if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            } catch (e) {
              console.error(`Error parsing local data for key ${key}`);
            }
          }
        }
        return null;
      };

      const parsedExpenses = getLocalData('obra-expenses');
      let count = 0;
      if (parsedExpenses) {
        const batch = parsedExpenses.map((exp: any) => ({
          description: exp.description || 'SEM DESCRIÇÃO',
          observation: exp.observation || '',
          total_value: Number(exp.totalValue) || 0,
          partner_value: Number(exp.partnerValue) || 0,
          date: exp.date || new Date().toISOString(),
          created_by: user.id
        }));
        const { error } = await supabase.from('expenses').insert(batch);
        if (!error) count += batch.length;
      }
      
      const parsedTasks = getLocalData('obra-tasks');
      if (parsedTasks) {
        const batch = parsedTasks.map((task: any) => ({
          text: task.text || 'Tarefa sem nome',
          completed: !!task.completed,
          created_by: user.id
        }));
        await supabase.from('tasks').insert(batch);
      }

      setMigrationMessage(`Recuperação concluída! ${count} gastos encontrados e enviados para a nuvem.`);
      fetchData();
      setTimeout(() => setMigrationMessage(''), 8000);
    } catch (e: any) {
      console.error(e);
      setMigrationMessage("Erro ao recuperar: " + e.message);
    }
  };

  // Auto-calculate Partner's value when total value changes
  useEffect(() => {
    const normalizedVal = totalValue.replace(/\./g, '').replace(',', '.');
    const val = parseFloat(normalizedVal);
    
    if (!isNaN(val)) {
      const calculated = (val / 3).toFixed(2).replace('.', ',');
      setPartnerValue(calculated);
    } else {
      setPartnerValue('');
    }
  }, [totalValue]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description || !totalValue || !user) return;

    const valTotal = parseFloat(totalValue.replace(/\./g, '').replace(',', '.'));
    const valPartner = parseFloat(partnerValue.replace(/\./g, '').replace(',', '.'));

    if (isNaN(valTotal) || isNaN(valPartner)) return;

    try {
      const { error } = await supabase.from('expenses').insert([{
        description: description.toUpperCase(),
        observation: observation,
        total_value: valTotal,
        partner_value: valPartner,
        date: new Date().toISOString(),
        created_by: user.id
      }]);

      if (error) throw error;

      setDescription('');
      setObservation('');
      setTotalValue('');
      setPartnerValue('');
      fetchData();
    } catch (error) {
      console.error("Error adding expense:", error);
      alert("Erro ao adicionar gasto.");
    }
  };

  const handleEditClick = (expense: Expense) => {
    setEditingExpense(expense);
    setEditDesc(expense.description);
    setEditObs(expense.observation || '');
    setEditTotal(expense.total_value.toFixed(2).replace('.', ','));
    setEditPartner(expense.partner_value.toFixed(2).replace('.', ','));
  };

  const handleEditTotalChange = (val: string) => {
    setEditTotal(val);
    const normalizedVal = val.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(normalizedVal);
    if (!isNaN(num)) {
      setEditPartner((num / 3).toFixed(2).replace('.', ','));
    } else {
      setEditPartner('');
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingExpense || !editDesc || !editTotal || !user) return;

    const valTotal = parseFloat(editTotal.replace(/\./g, '').replace(',', '.'));
    const valPartner = parseFloat(editPartner.replace(/\./g, '').replace(',', '.'));

    if (isNaN(valTotal) || isNaN(valPartner)) return;

    try {
      const { error } = await supabase.from('expenses').update({
        description: editDesc.toUpperCase(),
        observation: editObs,
        total_value: valTotal,
        partner_value: valPartner
      }).eq('id', editingExpense.id);
      
      if (error) throw error;
      setEditingExpense(null);
      fetchData();
    } catch (error) {
      console.error("Error updating expense:", error);
      alert("Erro ao atualizar gasto.");
    }
  };

  const handleDeleteExpense = (id: string) => {
    setExpenseToDelete(id);
  };

  const confirmDeleteExpense = async () => {
    if (!expenseToDelete) return;
    try {
      const { error } = await supabase.from('expenses').delete().eq('id', expenseToDelete);
      if (error) throw error;
      fetchData();
      setExpenseToDelete(null);
    } catch (error) {
      console.error("Error deleting expense:", error);
      alert("Erro ao excluir gasto.");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsUploading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      const batch: any[] = [];

      jsonData.forEach((row: any) => {
        const desc = row['Descrição'] || row['Descricao'] || row['description'] || row['Obra'] || row['Item'];
        const obs = row['Observação'] || row['Observacao'] || row['observation'] || row['Detalhes'];
        let total = row['Valor Total'] || row['Valor'] || row['Total'] || row['totalValue'];
        let partner = row['Valor Sócio'] || row['Sócio'] || row['partnerValue'];
        let date = row['Data'] || row['date'];

        if (!desc || total === undefined) return;

        if (typeof total === 'string') total = parseFloat(total.replace('R$', '').replace(/\./g, '').replace(',', '.'));
        if (typeof partner === 'string') partner = parseFloat(partner.replace('R$', '').replace(/\./g, '').replace(',', '.'));
        
        if (isNaN(total)) return;
        if (isNaN(partner) || partner === undefined) partner = total / 3;

        let parsedDate = new Date().toISOString();
        if (typeof date === 'number') {
          parsedDate = new Date(Math.round((date - 25569) * 86400 * 1000)).toISOString();
        } else if (typeof date === 'string') {
          const parts = date.split('/');
          if (parts.length === 3) {
            parsedDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`).toISOString();
          } else {
            const d = new Date(date);
            if (!isNaN(d.getTime())) parsedDate = d.toISOString();
          }
        }

        batch.push({
          description: String(desc).toUpperCase(),
          observation: obs ? String(obs) : '',
          total_value: Number(total),
          partner_value: Number(partner),
          date: parsedDate,
          created_by: user.id
        });
      });

      if (batch.length > 0) {
        const { error } = await supabase.from('expenses').insert(batch);
        if (error) throw error;
        alert(`${batch.length} gastos importados com sucesso!`);
        fetchData();
      } else {
        alert("Nenhum gasto válido encontrado na planilha. Verifique se as colunas têm nomes como 'Descrição' e 'Valor Total'.");
      }
    } catch (error) {
      console.error("Error parsing file:", error);
      alert("Erro ao ler a planilha. Certifique-se de que é um arquivo Excel (.xlsx) ou CSV válido.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsUploadingImage(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1];
          const mimeType = file.type;

          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: {
              parts: [
                {
                  inlineData: {
                    data: base64Data,
                    mimeType: mimeType,
                  },
                },
                {
                  text: "Extract the expenses from this spreadsheet or receipt image. Return a JSON array of expenses. If the date is missing, use the current date. Ensure numbers are properly parsed.",
                },
              ],
            },
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    description: { type: Type.STRING, description: "Expense description or item name" },
                    observation: { type: Type.STRING, description: "Additional details or observation" },
                    total_value: { type: Type.NUMBER, description: "Total value/cost" },
                    partner_value: { type: Type.NUMBER, description: "Partner value, usually 1/3 of total" },
                    date: { type: Type.STRING, description: "Date of expense in ISO format" }
                  },
                  required: ["description", "total_value"]
                }
              }
            }
          });

          const jsonStr = response.text?.trim();
          if (jsonStr) {
            const expenses = JSON.parse(jsonStr);
            const batch = expenses.map((exp: any) => ({
              description: String(exp.description).toUpperCase(),
              observation: exp.observation ? String(exp.observation) : '',
              total_value: Number(exp.total_value),
              partner_value: exp.partner_value ? Number(exp.partner_value) : Number(exp.total_value) / 3,
              date: exp.date || new Date().toISOString(),
              created_by: user.id
            }));

            if (batch.length > 0) {
              const { error } = await supabase.from('expenses').insert(batch);
              if (error) throw error;
              alert(`${batch.length} gastos importados com sucesso da imagem!`);
              fetchData();
            } else {
              alert("Nenhum gasto encontrado na imagem.");
            }
          }
        } catch (err) {
          console.error("Error processing image with Gemini:", err);
          alert("Erro ao processar a imagem com Inteligência Artificial.");
        } finally {
          setIsUploadingImage(false);
          if (imageInputRef.current) imageInputRef.current.value = '';
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Error reading file:", error);
      alert("Erro ao ler a imagem.");
      setIsUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskText.trim() || !user) return;
    
    try {
      const { error } = await supabase.from('tasks').insert([{
        text: newTaskText,
        completed: false,
        created_by: user.id
      }]);
      if (error) throw error;
      setNewTaskText('');
      fetchData();
    } catch (error) {
      console.error("Error adding task:", error);
      alert("Erro ao adicionar tarefa.");
    }
  };

  const toggleTask = async (task: Task) => {
    try {
      const { error } = await supabase.from('tasks').update({
        completed: !task.completed
      }).eq('id', task.id);
      if (error) throw error;
      fetchData();
    } catch (error) {
      console.error("Error updating task:", error);
    }
  };

  const deleteTask = async (id: string) => {
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', id);
      if (error) throw error;
      fetchData();
    } catch (error) {
      console.error("Error deleting task:", error);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    } catch (e) {
      return '';
    }
  };

  const filteredExpenses = useMemo(() => {
    return expenses
      .filter(e => e.description.toLowerCase().includes(searchTerm.toLowerCase()) || (e.observation && e.observation.toLowerCase().includes(searchTerm.toLowerCase())))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [expenses, searchTerm]);

  const totalGasto = useMemo(() => expenses.reduce((acc, curr) => acc + curr.total_value, 0), [expenses]);
  const totalPartner = useMemo(() => expenses.reduce((acc, curr) => acc + curr.partner_value, 0), [expenses]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!email || !password) {
      setLoginError('Preencha e-mail e senha.');
      return;
    }
    
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
      });
      if (error) setLoginError(error.message);
      else {
        alert('Conta criada! Você já pode fazer login (se o Supabase pedir confirmação, verifique seu e-mail).');
        setIsSignUp(false);
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) setLoginError(error.message);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-zinc-400 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
        <div className="bg-white rounded-[2rem] p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-zinc-100 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center text-white mx-auto mb-6 shadow-lg shadow-zinc-900/20">
            <HardHat className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 mb-2">Gestão de Obra</h1>
          <p className="text-zinc-500 mb-8">Faça login para acessar e sincronizar os gastos com seu sócio.</p>
          
          {loginError && (
            <div className="mb-6 p-4 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100 text-left">
              <p className="font-semibold mb-1">Erro:</p>
              <p>{loginError}</p>
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4 text-left">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">E-mail</label>
              <div className="relative">
                <Mail className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-zinc-50/50 rounded-xl border border-zinc-200/80 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all text-sm"
                  placeholder="seu@email.com"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Senha</label>
              <div className="relative">
                <Lock className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-zinc-50/50 rounded-xl border border-zinc-200/80 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all text-sm"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>
            
            <button
              type="submit"
              className="w-full bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-4 rounded-xl font-semibold flex items-center justify-center gap-3 transition-all shadow-sm active:scale-[0.98] cursor-pointer mt-6"
            >
              <LogIn className="w-5 h-5" />
              {isSignUp ? 'Criar Conta' : 'Entrar'}
            </button>
          </form>
          
          <button 
            onClick={() => setIsSignUp(!isSignUp)}
            className="mt-6 text-sm text-zinc-500 hover:text-zinc-900 transition-colors cursor-pointer"
          >
            {isSignUp ? 'Já tem uma conta? Faça login' : 'Não tem conta? Criar agora'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-zinc-900 font-sans relative pb-20">
      {/* Premium Glass Header */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-zinc-200/60 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center text-white shadow-md shadow-zinc-900/10">
              <HardHat className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Gestão de Obra</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:block text-right">
              <p className="text-sm font-medium text-zinc-900">{user.user_metadata?.full_name || user.email}</p>
              <p className="text-xs text-zinc-500">{user.email}</p>
            </div>
            <button
              onClick={logout}
              className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-colors cursor-pointer"
              title="Sair"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-zinc-100 flex flex-col justify-center relative overflow-hidden group hover:border-zinc-200 transition-colors">
            <div className="absolute -top-6 -right-6 p-8 opacity-[0.03] group-hover:opacity-[0.05] transition-opacity duration-500">
              <DollarSign className="w-48 h-48" />
            </div>
            <div className="relative z-10">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">Valor Pago (Total)</p>
              <p className="text-4xl sm:text-5xl font-light tracking-tight text-zinc-900">{formatCurrency(totalGasto)}</p>
            </div>
          </div>
          
          <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-zinc-100 flex flex-col justify-center relative overflow-hidden group hover:border-zinc-200 transition-colors">
            <div className="absolute -top-6 -right-6 p-8 opacity-[0.03] group-hover:opacity-[0.05] transition-opacity duration-500">
              <Calculator className="w-48 h-48" />
            </div>
            <div className="relative z-10">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">Valor por Sócio (1/3)</p>
              <p className="text-4xl sm:text-5xl font-light tracking-tight text-zinc-900">{formatCurrency(totalPartner)}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          
          {/* Left Column: Expenses */}
          <div className="xl:col-span-2 space-y-8">
            {/* Add Expense Form */}
            <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-zinc-100">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                <h2 className="text-lg font-semibold flex items-center gap-3 text-zinc-800">
                  <div className="p-2 bg-zinc-100 rounded-lg">
                    <Receipt className="w-4 h-4 text-zinc-600" />
                  </div>
                  Registrar Novo Gasto
                </h2>
                
                <div className="flex gap-2">
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    ref={imageInputRef}
                    onChange={handleImageUpload}
                  />
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={isUploadingImage}
                    className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isUploadingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                    <span className="hidden sm:inline">Ler Imagem</span>
                  </button>

                  <input 
                    type="file" 
                    accept=".xlsx, .xls, .csv" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    <span className="hidden sm:inline">Importar Planilha</span>
                  </button>
                </div>
              </div>
              <form onSubmit={handleAddExpense} className="grid grid-cols-1 md:grid-cols-4 gap-5 items-start">
                <div className="md:col-span-2 space-y-5">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Descrição (Obra)</label>
                    <input
                      type="text"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Ex: CIMENTO, PEDREIRO..."
                      className="w-full px-4 py-3 bg-zinc-50/50 rounded-xl border border-zinc-200/80 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all uppercase text-sm font-medium"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Observação (Opcional)</label>
                    <input
                      type="text"
                      value={observation}
                      onChange={(e) => setObservation(e.target.value)}
                      placeholder="Detalhes, loja, nf..."
                      className="w-full px-4 py-3 bg-zinc-50/50 rounded-xl border border-zinc-200/80 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Valor Pago (R$)</label>
                    <input
                      type="text"
                      value={totalValue}
                      onChange={(e) => setTotalValue(e.target.value)}
                      placeholder="0,00"
                      className="w-full px-4 py-3 bg-zinc-50/50 rounded-xl border border-zinc-200/80 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all text-sm font-medium"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Valor Sócio (R$)</label>
                    <input
                      type="text"
                      value={partnerValue}
                      onChange={(e) => setPartnerValue(e.target.value)}
                      placeholder="0,00"
                      className="w-full px-4 py-3 bg-zinc-50/50 rounded-xl border border-zinc-200/80 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all text-sm font-medium text-zinc-600"
                      required
                    />
                  </div>
                </div>
                <div className="md:col-span-4 flex justify-end mt-4">
                  <button
                    type="submit"
                    className="bg-zinc-900 hover:bg-zinc-800 text-white px-8 py-3.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all shadow-sm active:scale-[0.98] cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar Gasto
                  </button>
                </div>
              </form>
            </div>

            {/* Expenses List */}
            <div className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-zinc-100 overflow-hidden">
              <div className="p-6 border-b border-zinc-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                <h2 className="text-lg font-semibold text-zinc-800">Histórico de Gastos</h2>
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="Buscar gasto..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-11 pr-4 py-2.5 bg-zinc-50/50 rounded-full border border-zinc-200/80 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none text-sm transition-all"
                  />
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 bg-zinc-50/30">Obra / Data</th>
                      <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 bg-zinc-50/30 text-right">Valor Pago</th>
                      <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 bg-zinc-50/30 text-right">Valor por Sócio</th>
                      <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100 bg-zinc-50/30 text-center w-28">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredExpenses.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-zinc-400 text-sm">
                          Nenhum gasto encontrado.
                        </td>
                      </tr>
                    ) : (
                      filteredExpenses.map((expense) => (
                        <tr key={expense.id} className="hover:bg-zinc-50/80 transition-colors group">
                          <td className="px-6 py-5">
                            <div className="font-semibold text-zinc-800">{expense.description}</div>
                            {expense.observation && (
                              <div className="text-sm text-zinc-500 mt-1">{expense.observation}</div>
                            )}
                            <div className="text-xs text-zinc-400 mt-1.5 font-medium">{formatDate(expense.date)}</div>
                          </td>
                          <td className="px-6 py-5 text-right font-mono text-sm text-zinc-600">
                            {formatCurrency(expense.total_value)}
                          </td>
                          <td className="px-6 py-5 text-right font-mono text-sm font-medium text-zinc-900">
                            {formatCurrency(expense.partner_value)}
                          </td>
                          <td className="px-6 py-5 text-center">
                            <div className="flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleEditClick(expense)}
                                className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-colors cursor-pointer"
                                title="Editar"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteExpense(expense.id)}
                                className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
                                title="Excluir"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right Column: Tasks & Reminders */}
          <div className="xl:col-span-1">
            <div className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-zinc-100 overflow-hidden sticky top-28">
              <div className="p-6 border-b border-zinc-100 flex items-center gap-3">
                <div className="p-2 bg-zinc-100 rounded-lg">
                  <ListTodo className="w-4 h-4 text-zinc-600" />
                </div>
                <h2 className="text-lg font-semibold text-zinc-800">Tarefas e Lembretes</h2>
              </div>
              
              <div className="p-6">
                <form onSubmit={handleAddTask} className="mb-6 flex gap-2">
                  <input
                    type="text"
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                    placeholder="Adicionar nova tarefa..."
                    className="flex-1 px-4 py-2.5 bg-zinc-50/50 rounded-xl border border-zinc-200/80 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none text-sm transition-all"
                  />
                  <button
                    type="submit"
                    disabled={!newTaskText.trim()}
                    className="bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl transition-all cursor-pointer active:scale-[0.98]"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </form>

                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                  {tasks.length === 0 ? (
                    <div className="text-center py-10">
                      <p className="text-sm text-zinc-400">Nenhuma tarefa pendente.</p>
                    </div>
                  ) : (
                    tasks.map(task => (
                      <div 
                        key={task.id} 
                        className={`group flex items-start gap-3 p-4 rounded-2xl border transition-all ${
                          task.completed 
                            ? 'bg-zinc-50/50 border-transparent' 
                            : 'bg-white border-zinc-100 hover:border-zinc-300 hover:shadow-sm'
                        }`}
                      >
                        <button 
                          onClick={() => toggleTask(task)}
                          className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border flex items-center justify-center transition-all cursor-pointer ${
                            task.completed 
                              ? 'bg-zinc-900 border-zinc-900 text-white' 
                              : 'border-zinc-300 text-transparent hover:border-zinc-900'
                          }`}
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <span className={`flex-1 text-sm font-medium transition-colors ${task.completed ? 'text-zinc-400 line-through' : 'text-zinc-700'}`}>
                          {task.text}
                        </span>
                        <button
                          onClick={() => deleteTask(task.id)}
                          className="text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>
        
        {/* Manual Migration Button */}
        <div className="mt-10 text-center">
          <button
            onClick={forceMigrateLocalData}
            className="text-xs text-zinc-400 hover:text-zinc-600 underline transition-colors cursor-pointer"
          >
            Não está vendo seus gastos antigos? Clique aqui para forçar a recuperação.
          </button>
          {migrationMessage && (
            <p className="text-sm text-emerald-600 mt-3 font-medium bg-emerald-50 p-3 rounded-xl inline-block">{migrationMessage}</p>
          )}
        </div>
      </main>

      {/* Premium Edit Modal */}
      {editingExpense && (
        <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-zinc-100">
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-zinc-800 flex items-center gap-3">
                <div className="p-2 bg-zinc-100 rounded-lg">
                  <Edit2 className="w-4 h-4 text-zinc-600" />
                </div>
                Editar Gasto
              </h2>
              <button 
                onClick={() => setEditingExpense(null)} 
                className="text-zinc-400 hover:text-zinc-900 transition-colors cursor-pointer p-2 rounded-xl hover:bg-zinc-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Descrição (Obra)</label>
                <input
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-50/50 rounded-xl border border-zinc-200/80 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all uppercase text-sm font-medium"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Observação (Opcional)</label>
                <input
                  type="text"
                  value={editObs}
                  onChange={(e) => setEditObs(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-50/50 rounded-xl border border-zinc-200/80 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Valor Pago (R$)</label>
                  <input
                    type="text"
                    value={editTotal}
                    onChange={(e) => handleEditTotalChange(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-50/50 rounded-xl border border-zinc-200/80 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all text-sm font-medium"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Valor Sócio (R$)</label>
                  <input
                    type="text"
                    value={editPartner}
                    onChange={(e) => setEditPartner(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-50/50 rounded-xl border border-zinc-200/80 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-900 outline-none transition-all text-sm font-medium text-zinc-600"
                    required
                  />
                </div>
              </div>
              <div className="pt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingExpense(null)}
                  className="px-6 py-3.5 rounded-xl text-sm font-semibold text-zinc-600 hover:bg-zinc-100 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-3.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all shadow-sm active:scale-[0.98] cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {expenseToDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Excluir Gasto</h3>
            <p className="text-zinc-500 mb-6">Tem certeza que deseja excluir este gasto? Esta ação não pode ser desfeita.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setExpenseToDelete(null)}
                className="flex-1 px-4 py-3 rounded-xl font-semibold text-zinc-700 bg-zinc-100 hover:bg-zinc-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteExpense}
                className="flex-1 px-4 py-3 rounded-xl font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
