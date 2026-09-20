using System;
using System.IO;

// git 的离线测试替身：测试时把编译产物所在目录插到 PATH 最前，顶替真实 git。
// Windows 上 spawn/execSync 只认可执行文件，所以必须是 .exe（不能是 .cmd/.ps1）。
//
// 环境变量（均由套件设置）：
//   FAKE_GIT_LOG       把收到的参数追加写入该文件（用于断言"调了几次、参数是什么"）
//   FAKE_GIT_OUT       通用 stdout（默认 "Already up to date."）
//   FAKE_GIT_EXIT      退出码；非 0 时向 stderr 写一行并直接返回
//   FAKE_GIT_LSTREE    git ls-tree 的 stdout（默认一条 gitlink 记录）
//   FAKE_GIT_REVPARSE  git rev-parse 的 stdout（默认与 ls-tree 同值 → 上层视为已同步）
public class FakeGit
{
    public static int Main(string[] args)
    {
        string joined = string.Join(" ", args);

        string log = Environment.GetEnvironmentVariable("FAKE_GIT_LOG");
        if (!string.IsNullOrEmpty(log))
        {
            try { File.AppendAllText(log, joined + Environment.NewLine); } catch { }
        }

        string exitEnv = Environment.GetEnvironmentVariable("FAKE_GIT_EXIT");
        int code = 0;
        if (!string.IsNullOrEmpty(exitEnv)) int.TryParse(exitEnv, out code);
        if (code != 0)
        {
            Console.Error.WriteLine("fake git failure: " + joined);
            return code;
        }

        const string hash = "0123456789abcdef0123456789abcdef01234567";
        string sub = args.Length > 0 ? args[0] : "";
        string outEnv = Environment.GetEnvironmentVariable("FAKE_GIT_OUT");

        if (sub == "ls-tree")
        {
            string v = Environment.GetEnvironmentVariable("FAKE_GIT_LSTREE");
            Console.WriteLine(string.IsNullOrEmpty(v) ? "160000 commit " + hash + "\ttool/sub" : v);
        }
        else if (sub == "rev-parse")
        {
            string v = Environment.GetEnvironmentVariable("FAKE_GIT_REVPARSE");
            Console.WriteLine(string.IsNullOrEmpty(v) ? hash : v);
        }
        else
        {
            Console.WriteLine(string.IsNullOrEmpty(outEnv) ? "Already up to date." : outEnv);
        }
        return 0;
    }
}
