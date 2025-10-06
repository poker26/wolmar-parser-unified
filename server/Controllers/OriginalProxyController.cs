using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;

namespace MeshokParser.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class OriginalProxyController : ControllerBase
    {
        private readonly HttpClient _httpClient;

        public OriginalProxyController(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        [HttpGet("load")]
        public async Task<IActionResult> LoadUrl([FromQuery] string url)
        {
            if (string.IsNullOrEmpty(url))
            {
                return BadRequest("URL parameter is required");
            }

            try
            {
                // Согласно оригинальному репозиторию aioke/BrowserProxy
                // Сервер отправляет запрос в Chrome через DevTools Protocol
                // Chrome с расширением загружает страницу и обходит Cloudflare
                
                // Получаем список вкладок Chrome
                var tabsResponse = await _httpClient.GetAsync("http://localhost:9222/json");
                var tabsJson = await tabsResponse.Content.ReadAsStringAsync();
                var tabs = JsonSerializer.Deserialize<JsonElement[]>(tabsJson);

                if (tabs == null || tabs.Length == 0)
                {
                    return StatusCode(500, "No Chrome tabs available");
                }

                // Используем первую вкладку
                var tab = tabs[0];
                var webSocketUrl = tab.GetProperty("webSocketDebuggerUrl").GetString();

                if (string.IsNullOrEmpty(webSocketUrl))
                {
                    return StatusCode(500, "No WebSocket URL available");
                }

                // Подключаемся к Chrome через WebSocket
                using var webSocket = new System.Net.WebSockets.ClientWebSocket();
                await webSocket.ConnectAsync(new Uri(webSocketUrl), CancellationToken.None);

                // Отправляем команду навигации
                var navigateCommand = new
                {
                    id = 1,
                    method = "Page.navigate",
                    @params = new
                    {
                        url = url
                    }
                };

                var navigateJson = JsonSerializer.Serialize(navigateCommand);
                var navigateBytes = System.Text.Encoding.UTF8.GetBytes(navigateJson);
                await webSocket.SendAsync(new ArraySegment<byte>(navigateBytes), System.Net.WebSockets.WebSocketMessageType.Text, true, CancellationToken.None);

                // Ждем загрузки страницы
                await Task.Delay(5000);

                // Получаем HTML содержимое
                var htmlCommand = new
                {
                    id = 2,
                    method = "Runtime.evaluate",
                    @params = new
                    {
                        expression = "document.documentElement.outerHTML"
                    }
                };

                var htmlJson = JsonSerializer.Serialize(htmlCommand);
                var htmlBytes = System.Text.Encoding.UTF8.GetBytes(htmlJson);
                await webSocket.SendAsync(new ArraySegment<byte>(htmlBytes), System.Net.WebSockets.WebSocketMessageType.Text, true, CancellationToken.None);

                // Получаем ответы от WebSocket - ждем несколько ответов
                var html = "";
                var buffer = new byte[1024 * 1024];
                
                // Ждем ответы от WebSocket
                for (int i = 0; i < 10; i++) // Максимум 10 попыток
                {
                    var result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                    var responseJson = System.Text.Encoding.UTF8.GetString(buffer, 0, result.Count);
                    var response = JsonSerializer.Deserialize<JsonElement>(responseJson);

                    // Проверяем, есть ли результат с HTML
                    if (response.TryGetProperty("result", out var resultElement) && 
                        resultElement.TryGetProperty("value", out var valueElement))
                    {
                        html = valueElement.GetString() ?? "";
                        if (!string.IsNullOrEmpty(html))
                        {
                            break; // Нашли HTML, выходим из цикла
                        }
                    }
                    
                    // Небольшая задержка между попытками
                    await Task.Delay(500);
                }

                // Закрываем WebSocket соединение
                await webSocket.CloseAsync(System.Net.WebSockets.WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);

                return Ok(new
                {
                    success = true,
                    url = url,
                    html = html,
                    timestamp = System.DateTime.UtcNow,
                    method = "chrome_extension_proxy"
                });
            }
            catch (System.Exception ex)
            {
                return StatusCode(500, new
                {
                    success = false,
                    error = ex.Message
                });
            }
        }
    }
}
